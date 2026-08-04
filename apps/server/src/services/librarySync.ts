/**
 * Library Sync Service - Fetches library items from media servers and creates snapshots
 *
 * Orchestrates the library synchronization workflow:
 * 1. Fetch items from media server in batches with rate limiting
 * 2. Upsert items to libraryItems table
 * 3. Detect additions and removals (delta detection)
 * 4. Create snapshot with aggregate statistics
 * 5. Report progress via callback for real-time updates
 */

import { eq, and, inArray, notInArray, sql, gte, lt, desc, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  servers,
  libraryItems,
  libraryItemVersions,
  librarySnapshots,
  libraries as librariesTable,
} from '../db/schema.js';
import {
  createMediaServerClient,
  type MediaLibrary,
  type MediaLibraryItem,
} from './mediaServer/index.js';
import { resolveMediaBatch, reconcileMediaDuplicates } from './library/mediaResolutionService.js';
import { backfillSessionIdentityBatch } from '../jobs/sessionIdentityBackfill.js';
import { refreshAggregates } from '../db/timescale.js';
import type { LibrarySyncProgress } from '@tracearr/shared';
import {
  REDIS_KEYS,
  resolutionBucket,
  resolutionTierRank,
  RESOLUTION_TIERS,
  LEGACY_VERSION_SENTINEL,
} from '@tracearr/shared';
import { resolutionBucketPredicate, resolutionRankSql } from '../utils/resolutionBuckets.js';
import { getHeavyOpsStatus } from '../jobs/heavyOpsLock.js';
import { scrubStringFields } from '../utils/sanitizeText.js';
import type { Redis } from 'ioredis';

// Constants for batching and rate limiting.
// Page size is not a Tracearr memory concern (the full-scan accumulators are
// page-size independent); it bounds how large a response the MEDIA server
// must build per request, so the env override is the escape hatch for a
// server that struggles building large containers.
const BATCH_SIZE = Math.min(1000, Math.max(50, Number(process.env.LIBRARY_SYNC_PAGE_SIZE) || 200));
const BATCH_DELAY_MS = 150;
const BATCH_DELAY_MS_INCREMENTAL = 50;
const SYNC_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
const SYNC_STATE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

/** Force a full scan every N scheduled syncs per library (safety net for all server types) */
const FULL_SCAN_INTERVAL = 7;

/** If incremental sync returns more than this fraction of total items, fall through to full scan */
const INCREMENTAL_CAP_RATIO = 0.3;

/**
 * Incremental sync only returns items whose server updatedAt moved, so two
 * kinds of drift never surface on their own: a same-cycle remove+add (our
 * active row count grows past the server's true total), and a wrong
 * tombstone from a spurious removal event (our active row count falls below
 * it). These two constants set how far our local count can drift from the
 * server's before that's treated as evidence of a missed change and
 * escalated to a full scan (which does real delta detection). Overcount is
 * checked before the incremental sync runs; undercount is checked after,
 * since ordinary library growth also leaves the local count behind the
 * server's until the sync catches it up. Whichever tolerance is larger wins.
 */
const COUNT_MISMATCH_MIN_TOLERANCE = 3;
const COUNT_MISMATCH_RATIO = 0.01;

// Undercount escalation compares the drift against an accepted structural shortfall, not zero - see computeAcceptedShortfall.
/** Music-type library sections: their server totalCount spans a different item universe than we store, so the undercount check is skipped for them. */
const MUSIC_LIBRARY_TYPES = new Set(['music', 'artist']);

let redisClient: Redis | null = null;

function getPersistableItems(items: MediaLibraryItem[]): MediaLibraryItem[] {
  return items.filter((item) => Boolean(item.ratingKey));
}

/**
 * Initialize the library sync service with a Redis client.
 * Required to enable incremental sync state persistence.
 */
export function initLibrarySyncRedis(redis: Redis): void {
  redisClient = redis;
}

/** Fields createSnapshot needs — works with both API items and DB rows */
interface SnapshotStats {
  itemCount: number;
  totalSize: number;
  movieCount: number;
  episodeCount: number;
  seasonCount: number;
  showCount: number;
  musicCount: number;
  count4k: number;
  count1080p: number;
  count720p: number;
  countSd: number;
  hevcCount: number;
  h264Count: number;
  av1Count: number;
  countHighQuality: number;
  versionCount: number;
}

interface SnapshotItemInput {
  fileSize?: number | null;
  videoResolution?: string | null;
  videoCodec?: string | null;
  mediaType: string;
  /** Active versions; absent falls back to the flat fields as one version */
  versions?: Array<{ videoResolution?: string | null; videoCodec?: string | null }>;
}

/**
 * Result of syncing a single library
 */
export interface SyncResult {
  serverId: string;
  libraryId: string;
  libraryName: string;
  itemsProcessed: number;
  itemsAdded: number;
  itemsRemoved: number;
  itemsSkipped: number; // items dropped because the upstream parser produced an empty ratingKey
  snapshotId: string | null; // null when snapshot skipped due to incomplete sync
}

/**
 * Progress callback for real-time updates
 */
export type OnProgressCallback = (progress: LibrarySyncProgress) => void;

/**
 * Helper to delay between batches (rate limiting)
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bind a genre list as one param; drizzle expands a raw array into a record that cannot cast to text[] */
function toPgTextArrayLiteral(values: string[]): string {
  const escaped = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
}

/**
 * Library Sync Service
 *
 * Handles fetching library items from media servers, persisting to database,
 * creating snapshots with quality statistics, and detecting delta changes.
 */
export class LibrarySyncService {
  /**
   * Sync all libraries for a server
   *
   * @param serverId - The server ID to sync
   * @param onProgress - Optional callback for progress updates
   * @param triggeredBy - Whether sync was triggered manually or by scheduler
   * @returns Array of SyncResult for each library
   */
  async syncServer(
    serverId: string,
    onProgress?: OnProgressCallback,
    triggeredBy: 'manual' | 'scheduled' = 'scheduled'
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    // Get server configuration
    const server = await this.getServer(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const startedAt = new Date().toISOString();

    // Create media server client
    const client = createMediaServerClient({
      type: server.type,
      url: server.url,
      token: server.token,
      ignoreAnonymousStreams: server.ignoreAnonymousStreams,
      id: server.id,
      name: server.name,
    });

    // Preflight with the client's 10s bound: an unreachable server fails
    // here immediately with one clear message instead of grinding every
    // library and page through fetch timeouts. Sync state (cycle counter,
    // watermark) is untouched, so the next reachable sync picks up exactly
    // where it left off. The poller owns health-state transitions and
    // up/down notifications; this only guards the sync itself.
    if (!(await client.testConnection())) {
      throw new Error(`${server.name} is unreachable - skipping library sync`);
    }

    // Fetch all libraries and filter out unsupported types (e.g., photo libraries)
    const UNSUPPORTED_LIBRARY_TYPES = new Set(['photo', 'boxsets', 'playlists']);
    const allLibraries = await client.getLibraries();
    const libraries = allLibraries.filter((lib) => {
      if (UNSUPPORTED_LIBRARY_TYPES.has(lib.type.toLowerCase())) {
        console.log(
          `[LibrarySync] Skipping unsupported library type "${lib.type}": ${lib.name} (${lib.id})`
        );
        return false;
      }
      return true;
    });
    const totalLibraries = libraries.length;

    // Report initial progress
    if (onProgress) {
      onProgress({
        serverId,
        serverName: server.name,
        status: 'running',
        totalLibraries,
        processedLibraries: 0,
        totalItems: 0,
        processedItems: 0,
        message: `Starting sync of ${totalLibraries} libraries...`,
        startedAt,
      });
    }

    // Sync each library
    for (let i = 0; i < libraries.length; i++) {
      const library = libraries[i];
      if (!library) {
        continue;
      }

      const result = await this.syncLibrary(
        serverId,
        server.name,
        library.id,
        library.name,
        library.type,
        client,
        onProgress,
        totalLibraries,
        i,
        startedAt,
        triggeredBy
      );

      results.push(result);
    }

    // Clean up items and snapshots for libraries that no longer exist on the server.
    // Skip when server reports 0 libraries (e.g., during restart) to avoid deleting all data.
    if (libraries.length > 0) {
      const currentLibraryIds = new Set(libraries.map((lib) => lib.id));
      const cleanup = await this.cleanupOrphanedLibraries(serverId, currentLibraryIds);
      if (cleanup.removedLibraryIds.length > 0) {
        console.log(
          `[LibrarySync] Cleaned up ${cleanup.removedLibraryIds.length} orphaned libraries ` +
            `for ${server.name}: ${cleanup.removedLibraryIds.join(', ')}`
        );
        // Synthetic result so the queue's itemsRemoved > 0 cache-invalidation check sees this hard delete.
        results.push({
          serverId,
          libraryId: 'orphan-cleanup',
          libraryName: 'Orphaned libraries cleanup',
          itemsProcessed: 0,
          itemsAdded: 0,
          itemsRemoved: cleanup.removedItemCount,
          itemsSkipped: 0,
          snapshotId: null,
        });
      }
    }

    await this.syncLibraryNames(serverId, libraries);

    // Report completion
    if (onProgress) {
      const totalItems = results.reduce((sum, r) => sum + r.itemsProcessed, 0);
      const totalAdded = results.reduce((sum, r) => sum + r.itemsAdded, 0);
      const totalRemoved = results.reduce((sum, r) => sum + r.itemsRemoved, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.itemsSkipped, 0);

      const skippedSuffix =
        totalSkipped > 0 ? `, ${totalSkipped} skipped (missing rating_key)` : '';

      onProgress({
        serverId,
        serverName: server.name,
        status: 'complete',
        totalLibraries,
        processedLibraries: totalLibraries,
        totalItems,
        processedItems: totalItems,
        message: `Sync complete: ${totalItems} items, ${totalAdded} added, ${totalRemoved} removed${skippedSuffix}`,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    }

    // Newly synced library items may match sessions that predate identity stamping.
    // Single bounded batch. Never let a backfill failure skip the reconcile/cache
    // steps below - the item upserts above already succeeded.
    try {
      const repaired = await backfillSessionIdentityBatch(10000);
      if (repaired.updated > 0 && repaired.oldest) {
        await refreshAggregates({ startTime: repaired.oldest, endTime: new Date() });
      }
    } catch (err) {
      console.error('[LibrarySync] Session identity backfill failed, continuing sync:', err);
    }

    const merges = await reconcileMediaDuplicates();
    if (merges > 0) {
      console.log(`[LibrarySync] Reconciled ${merges} duplicate media rows`);
    }

    return results;
  }

  /**
   * Sync a single library
   *
   * Recomputes latest_added_at once per library, even on failure, never per batch.
   */
  private async syncLibrary(
    serverId: string,
    serverName: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    client: ReturnType<typeof createMediaServerClient>,
    onProgress: OnProgressCallback | undefined,
    totalLibraries: number,
    processedLibraries: number,
    startedAt: string,
    triggeredBy: 'manual' | 'scheduled'
  ): Promise<SyncResult> {
    const touchedMediaIds = new Set<string>();
    let result: SyncResult;
    try {
      result = await this.runLibrarySync(
        serverId,
        serverName,
        libraryId,
        libraryName,
        libraryType,
        client,
        onProgress,
        totalLibraries,
        processedLibraries,
        startedAt,
        triggeredBy,
        touchedMediaIds
      );
    } catch (err) {
      await this.recomputeLatestAddedAt([...touchedMediaIds]).catch(() => undefined);
      throw err;
    }
    await this.recomputeLatestAddedAt([...touchedMediaIds]);
    return result;
  }

  private async runLibrarySync(
    serverId: string,
    serverName: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    client: ReturnType<typeof createMediaServerClient>,
    onProgress: OnProgressCallback | undefined,
    totalLibraries: number,
    processedLibraries: number,
    startedAt: string,
    triggeredBy: 'manual' | 'scheduled',
    touchedMediaIds: Set<string>
  ): Promise<SyncResult> {
    // Music skips the undercount check only - overcount stays on since it's structurally safe there.
    const isMusicLibrary = MUSIC_LIBRARY_TYPES.has(libraryType.toLowerCase());

    // Fetch total count first
    const { totalCount } = await client.getLibraryItems(libraryId, { offset: 0, limit: 1 });

    // Load sync state from Redis
    const syncState = await this.getSyncState(serverId, libraryId);

    // Overcount-only pre-sync check (see COUNT_MISMATCH_* doc comment above).
    let overcountMismatch = false;
    let localActiveCount: number | null = null;
    let countTolerance: number | null = null;
    if (triggeredBy !== 'manual' && syncState.lastSyncedAt !== null) {
      localActiveCount = await this.getActiveItemCount(serverId, libraryId);
      countTolerance = Math.max(
        COUNT_MISMATCH_MIN_TOLERANCE,
        Math.ceil(totalCount * COUNT_MISMATCH_RATIO)
      );
      overcountMismatch = localActiveCount - totalCount > countTolerance;
    }

    // Decision tree: incremental only when we have prior state, count hasn't dropped, and not manual
    const forceFullScan =
      triggeredBy === 'manual' ||
      (syncState.syncCycle > 0 && syncState.syncCycle % FULL_SCAN_INTERVAL === 0) ||
      overcountMismatch;

    const isIncremental =
      syncState.lastSyncedAt !== null &&
      syncState.lastItemCount !== null &&
      totalCount >= syncState.lastItemCount &&
      !forceFullScan;

    if (isIncremental) {
      const lastSyncedAt = syncState.lastSyncedAt;
      if (!lastSyncedAt) {
        throw new Error('Incremental sync requires lastSyncedAt');
      }
      console.log(
        `[LibrarySync] Incremental sync for ${libraryName}: last synced ${lastSyncedAt.toISOString()}, ` +
          `count ${syncState.lastItemCount} → ${totalCount}, cycle ${syncState.syncCycle + 1}/${FULL_SCAN_INTERVAL}`
      );
    } else {
      const reason = !syncState.lastSyncedAt
        ? 'first sync'
        : totalCount < (syncState.lastItemCount ?? 0)
          ? 'items removed'
          : overcountMismatch
            ? `local active count exceeds server total (local ${localActiveCount} vs server ${totalCount})`
            : forceFullScan && triggeredBy === 'manual'
              ? 'manual trigger'
              : forceFullScan
                ? `periodic full scan (cycle ${syncState.syncCycle})`
                : 'unknown';
      console.log(`[LibrarySync] Full sync for ${libraryName}: ${reason}`);
    }

    // Report starting library
    if (onProgress) {
      onProgress({
        serverId,
        serverName,
        status: 'running',
        currentLibrary: libraryId,
        currentLibraryName: libraryName,
        totalLibraries,
        processedLibraries,
        totalItems: totalCount,
        processedItems: 0,
        message: `Syncing library: ${libraryName} (${totalCount} items)...`,
        startedAt,
      });
    }

    // =========================================================================
    // INCREMENTAL PATH
    // =========================================================================
    if (isIncremental && client.getLibraryItemsSince) {
      try {
        const lastSyncedAt = syncState.lastSyncedAt;
        if (!lastSyncedAt) {
          throw new Error('Incremental sync requires lastSyncedAt');
        }
        const { items: newItems, totalCount: incrementalCount } = await client.getLibraryItemsSince(
          libraryId,
          lastSyncedAt
        );

        // Check for new episodes/tracks independently — new episodes can arrive
        // for shows that were added months ago (no new Series in the result).
        let newLeaves: MediaLibraryItem[] = [];
        if (client.getLibraryLeavesSince) {
          try {
            const { items: leaves } = await client.getLibraryLeavesSince(
              libraryId,
              lastSyncedAt
            );
            newLeaves = leaves;
          } catch (leafErr) {
            console.warn(
              `[LibrarySync] Incremental leaf fetch failed for ${libraryName}, skipping leaves:`,
              leafErr
            );
          }
        }

        // Plex only - JF/Emby seasons already arrived via getLibraryLeavesSince above
        let newSeasons: MediaLibraryItem[] = [];
        if (libraryType.toLowerCase() === 'show' && client.getLibrarySeasonsSince) {
          try {
            const { items: seasons } = await client.getLibrarySeasonsSince(
              libraryId,
              syncState.lastSyncedAt!
            );
            newSeasons = seasons;
          } catch (seasonErr) {
            console.warn(
              `[LibrarySync] Incremental season fetch failed for ${libraryName}, skipping seasons:`,
              seasonErr
            );
          }
        }

        if (
          incrementalCount === 0 &&
          newLeaves.length === 0 &&
          newSeasons.length === 0 &&
          totalCount === syncState.lastItemCount
        ) {
          if (
            !isMusicLibrary &&
            countTolerance !== null &&
            (await this.hasUndercountMismatch(
              serverId,
              libraryId,
              totalCount,
              countTolerance,
              syncState.acceptedShortfall
            ))
          ) {
            console.log(
              `[LibrarySync] ${libraryName}: no changes reported but local active count is still below server total, escalating to full scan`
            );
            throw new Error('UNDERCOUNT_MISMATCH');
          }
          console.log(`[LibrarySync] ${libraryName}: no changes since last sync, skipping`);
          const snapshot = await this.copyLastSnapshot(serverId, libraryId);
          await this.saveSyncState(serverId, libraryId, totalCount, syncState.syncCycle + 1);
          return {
            serverId,
            libraryId,
            libraryName,
            itemsProcessed: 0,
            itemsAdded: 0,
            itemsRemoved: 0,
            itemsSkipped: 0,
            snapshotId: snapshot?.id ?? null,
          };
        }

        // Cap check: if too many items were returned, fall through to full scan
        // which also handles orphan detection
        const incrementalCap = Math.floor(totalCount * INCREMENTAL_CAP_RATIO);
        const totalIncrementalItems = newItems.length + newLeaves.length + newSeasons.length;

        if (incrementalCap > 0 && totalIncrementalItems > incrementalCap) {
          console.log(
            `[LibrarySync] Incremental returned ${totalIncrementalItems} items (cap: ${incrementalCap}), falling back to full scan`
          );
          throw new Error('CAP_EXCEEDED');
        }

        const allItems: MediaLibraryItem[] = [];
        const combinedItems = [...newItems, ...newLeaves, ...newSeasons];
        let totalSkippedEmpty = 0;

        for (let i = 0; i < combinedItems.length; i += BATCH_SIZE) {
          const batch = combinedItems.slice(i, i + BATCH_SIZE);
          allItems.push(...batch);
          const { skippedEmpty } = await this.upsertItems(
            serverId,
            libraryId,
            batch,
            touchedMediaIds
          );
          totalSkippedEmpty += skippedEmpty;

          if (i + BATCH_SIZE < combinedItems.length) {
            await delay(BATCH_DELAY_MS_INCREMENTAL);
          }
        }

        // Post-sync undercount check, so ordinary growth isn't mistaken for a wrong tombstone.
        if (
          !isMusicLibrary &&
          countTolerance !== null &&
          (await this.hasUndercountMismatch(
            serverId,
            libraryId,
            totalCount,
            countTolerance,
            syncState.acceptedShortfall
          ))
        ) {
          console.log(
            `[LibrarySync] ${libraryName}: local active count still below server total after incremental sync, escalating to full scan`
          );
          throw new Error('UNDERCOUNT_MISMATCH');
        }

        // Snapshot rebuild is local DB work — don't let failures trigger a full scan
        let snapshot: { id: string } | null = null;
        try {
          const heavyOps = await getHeavyOpsStatus();
          if (!heavyOps) {
            snapshot = await this.rebuildSnapshotFromDb(serverId, libraryId);
          }
        } catch (snapshotError) {
          console.warn(
            `[LibrarySync] Failed to rebuild snapshot for ${libraryName} (items were upserted OK):`,
            snapshotError
          );
        }

        await this.saveSyncState(serverId, libraryId, totalCount, syncState.syncCycle + 1);

        return {
          serverId,
          libraryId,
          libraryName,
          itemsProcessed: allItems.length,
          itemsAdded: allItems.length,
          itemsRemoved: 0,
          itemsSkipped: totalSkippedEmpty,
          snapshotId: snapshot?.id ?? null,
        };
      } catch (error) {
        const isCap = error instanceof Error && error.message === 'CAP_EXCEEDED';
        const isUndercount = error instanceof Error && error.message === 'UNDERCOUNT_MISMATCH';
        const msg = isCap
          ? `Incremental sync exceeded cap for ${libraryName}, using full scan`
          : isUndercount
            ? `Local active count for ${libraryName} still below server total, using full scan`
            : `Incremental fetch failed for ${libraryName}, falling back to full scan`;
        if (isCap || isUndercount) {
          console.warn(`[LibrarySync] ${msg}`);
        } else {
          console.warn(`[LibrarySync] ${msg}`, error);
        }
        // Fall through to full scan path below
      }
    }

    // =========================================================================
    // FULL SCAN PATH (original code, unchanged)
    // =========================================================================

    // Get previous item keys for delta detection
    const previousKeys = await this.getPreviousItemKeys(serverId, libraryId);
    const currentKeys = new Set<string>();
    const allItems: MediaLibraryItem[] = [];
    let totalSkippedEmpty = 0;

    // Fetch items in batches with pagination
    let offset = 0;
    let processedItems = 0;

    while (offset < totalCount) {
      const { items, rawCount } = await client.getLibraryItems(libraryId, {
        offset,
        limit: BATCH_SIZE,
      });

      // A page that's all extras parses to zero items even though the server page
      // was full, so the empty check must use rawCount, not the filtered items
      if ((rawCount ?? items.length) === 0) break;

      const persistableItems = getPersistableItems(items);

      // Track only keys we actually persist for delta detection and snapshots
      for (const item of persistableItems) {
        currentKeys.add(item.ratingKey);
        allItems.push(item);
      }

      // Upsert batch to database
      const itemsRes = await this.upsertItems(serverId, libraryId, items, touchedMediaIds);
      totalSkippedEmpty += itemsRes.skippedEmpty;

      processedItems += items.length;
      offset += BATCH_SIZE;

      // Report progress
      if (onProgress) {
        onProgress({
          serverId,
          serverName,
          status: 'running',
          currentLibrary: libraryId,
          currentLibraryName: libraryName,
          totalLibraries,
          processedLibraries,
          totalItems: totalCount,
          processedItems,
          message: `${libraryName}: ${processedItems}/${totalCount} items processed...`,
          startedAt,
        });
      }

      // Rate limit between batches
      if (offset < totalCount) {
        await delay(BATCH_DELAY_MS);
      }
    }

    // For TV libraries (contains shows), also fetch all episodes
    const hasShows = allItems.some((item) => item.mediaType === 'show');
    if (hasShows && client.getLibraryLeaves) {
      // Report episode fetching
      if (onProgress) {
        onProgress({
          serverId,
          serverName,
          status: 'running',
          currentLibrary: libraryId,
          currentLibraryName: libraryName,
          totalLibraries,
          processedLibraries,
          totalItems: totalCount,
          processedItems,
          message: `${libraryName}: Fetching episodes...`,
          startedAt,
        });
      }

      // Fetch episode count
      const { totalCount: episodeCount } = await client.getLibraryLeaves(libraryId, {
        offset: 0,
        limit: 1,
      });

      // Fetch episodes in batches
      let episodeOffset = 0;
      let episodesProcessed = 0;

      while (episodeOffset < episodeCount) {
        const { items: episodes, rawCount } = await client.getLibraryLeaves(libraryId, {
          offset: episodeOffset,
          limit: BATCH_SIZE,
        });

        if ((rawCount ?? episodes.length) === 0) break;

        const persistableEpisodes = getPersistableItems(episodes);

        // Track only keys we actually persist for delta detection and snapshots
        for (const episode of persistableEpisodes) {
          currentKeys.add(episode.ratingKey);
          allItems.push(episode);
        }

        // Upsert episodes to database
        const epRes = await this.upsertItems(serverId, libraryId, episodes, touchedMediaIds);
        totalSkippedEmpty += epRes.skippedEmpty;

        episodesProcessed += episodes.length;
        episodeOffset += BATCH_SIZE;

        // Report progress
        if (onProgress) {
          onProgress({
            serverId,
            serverName,
            status: 'running',
            currentLibrary: libraryId,
            currentLibraryName: libraryName,
            totalLibraries,
            processedLibraries,
            totalItems: totalCount + episodeCount,
            processedItems: processedItems + episodesProcessed,
            message: `${libraryName}: ${episodesProcessed}/${episodeCount} episodes processed...`,
            startedAt,
          });
        }

        // Rate limit between batches
        if (episodeOffset < episodeCount) {
          await delay(BATCH_DELAY_MS);
        }
      }

      processedItems += episodesProcessed;
    }

    // Plex seasons: a dedicated type=3 fetch (JF/Emby get seasons for free
    // through getLibraryLeaves above, so client.getLibrarySeasons is undefined there)
    if (hasShows && client.getLibrarySeasons) {
      const { totalCount: seasonCount } = await client.getLibrarySeasons(libraryId, {
        offset: 0,
        limit: 1,
      });

      let seasonOffset = 0;
      let seasonsProcessed = 0;

      while (seasonOffset < seasonCount) {
        const { items: seasons, rawCount } = await client.getLibrarySeasons(libraryId, {
          offset: seasonOffset,
          limit: BATCH_SIZE,
        });

        if ((rawCount ?? seasons.length) === 0) break;

        for (const season of seasons) {
          currentKeys.add(season.ratingKey);
          allItems.push(season);
        }

        const seasonRes = await this.upsertItems(serverId, libraryId, seasons, touchedMediaIds);
        totalSkippedEmpty += seasonRes.skippedEmpty;

        seasonsProcessed += seasons.length;
        seasonOffset += BATCH_SIZE;

        if (seasonOffset < seasonCount) {
          await delay(BATCH_DELAY_MS);
        }
      }

      processedItems += seasonsProcessed;
    }

    // For music libraries (contains artists), also fetch all tracks
    const hasArtists = allItems.some((item) => item.mediaType === 'artist');
    if (hasArtists && client.getLibraryLeaves) {
      // Report track fetching
      if (onProgress) {
        onProgress({
          serverId,
          serverName,
          status: 'running',
          currentLibrary: libraryId,
          currentLibraryName: libraryName,
          totalLibraries,
          processedLibraries,
          totalItems: totalCount,
          processedItems,
          message: `${libraryName}: Fetching tracks...`,
          startedAt,
        });
      }

      // Fetch track count
      const { totalCount: trackCount } = await client.getLibraryLeaves(libraryId, {
        offset: 0,
        limit: 1,
      });

      // Fetch tracks in batches
      let trackOffset = 0;
      let tracksProcessed = 0;

      while (trackOffset < trackCount) {
        const { items: tracks, rawCount } = await client.getLibraryLeaves(libraryId, {
          offset: trackOffset,
          limit: BATCH_SIZE,
        });

        if ((rawCount ?? tracks.length) === 0) break;

        const persistableTracks = getPersistableItems(tracks);

        // Track only keys we actually persist for delta detection and snapshots
        for (const track of persistableTracks) {
          currentKeys.add(track.ratingKey);
          allItems.push(track);
        }

        // Upsert tracks to database
        const trkRes = await this.upsertItems(serverId, libraryId, tracks, touchedMediaIds);
        totalSkippedEmpty += trkRes.skippedEmpty;

        tracksProcessed += tracks.length;
        trackOffset += BATCH_SIZE;

        // Report progress
        if (onProgress) {
          onProgress({
            serverId,
            serverName,
            status: 'running',
            currentLibrary: libraryId,
            currentLibraryName: libraryName,
            totalLibraries,
            processedLibraries,
            totalItems: totalCount + trackCount,
            processedItems: processedItems + tracksProcessed,
            message: `${libraryName}: ${tracksProcessed}/${trackCount} tracks processed...`,
            startedAt,
          });
        }

        // Rate limit between batches
        if (trackOffset < trackCount) {
          await delay(BATCH_DELAY_MS);
        }
      }

      processedItems += tracksProcessed;
    }

    // Calculate delta
    const addedKeys = [...currentKeys].filter((k) => !previousKeys.has(k));
    const removedKeys = [...previousKeys].filter((k) => !currentKeys.has(k));

    // Mark removed items (delete from database)
    if (removedKeys.length > 0) {
      await this.markItemsRemoved(serverId, libraryId, removedKeys, touchedMediaIds);
    }

    const uniqueAllItems = Array.from(
      new Map(allItems.filter((i) => i.ratingKey).map((i) => [i.ratingKey, i])).values()
    );

    // Validate sync completeness before creating snapshot
    // TV libraries with shows should have episodes, Music libraries with artists should have tracks
    const showCount = uniqueAllItems.filter((i) => i.mediaType === 'show').length;
    const episodeCount = uniqueAllItems.filter((i) => i.mediaType === 'episode').length;
    const artistCount = uniqueAllItems.filter((i) => i.mediaType === 'artist').length;
    const trackCount = uniqueAllItems.filter((i) => i.mediaType === 'track').length;

    if (showCount > 0 && episodeCount === 0) {
      console.warn(
        `[LibrarySync] Skipping snapshot for ${libraryName}: has ${showCount} shows but no episodes (likely incomplete sync). Not saving sync state — next cycle will retry.`
      );
      return {
        serverId,
        libraryId,
        libraryName,
        itemsProcessed: processedItems,
        itemsAdded: addedKeys.length,
        itemsRemoved: removedKeys.length,
        itemsSkipped: totalSkippedEmpty,
        snapshotId: null,
      };
    }

    if (artistCount > 0 && trackCount === 0) {
      console.warn(
        `[LibrarySync] Skipping snapshot for ${libraryName}: has ${artistCount} artists but no tracks (likely incomplete sync). Not saving sync state — next cycle will retry.`
      );
      return {
        serverId,
        libraryId,
        libraryName,
        itemsProcessed: processedItems,
        itemsAdded: addedKeys.length,
        itemsRemoved: removedKeys.length,
        itemsSkipped: totalSkippedEmpty,
        snapshotId: null,
      };
    }

    // Skip snapshot creation if a heavy operation is running (prevents deadlocks)
    // The heavy op (e.g., backfill) will create accurate snapshots when it completes
    const heavyOps = await getHeavyOpsStatus();
    if (heavyOps) {
      console.log(
        `[LibrarySync] Skipping snapshot creation - ${heavyOps.jobType} job is running: ${heavyOps.description}`
      );
      const acceptedShortfall = await this.computeAcceptedShortfall(
        serverId,
        libraryId,
        totalCount,
        isMusicLibrary,
        triggeredBy,
        syncState.acceptedShortfall
      );
      await this.saveSyncState(serverId, libraryId, totalCount, 0, acceptedShortfall);
      return {
        serverId,
        libraryId,
        libraryName,
        itemsProcessed: processedItems,
        itemsAdded: addedKeys.length,
        itemsRemoved: removedKeys.length,
        itemsSkipped: totalSkippedEmpty,
        snapshotId: null,
      };
    }

    // Create snapshot (may return null if data is invalid - e.g., no file sizes)
    const snapshot = await this.createSnapshot(serverId, libraryId, uniqueAllItems);

    const acceptedShortfall = await this.computeAcceptedShortfall(
      serverId,
      libraryId,
      totalCount,
      isMusicLibrary,
      triggeredBy,
      syncState.acceptedShortfall
    );
    await this.saveSyncState(serverId, libraryId, totalCount, 0, acceptedShortfall);

    return {
      serverId,
      libraryId,
      libraryName,
      itemsProcessed: processedItems,
      itemsAdded: addedKeys.length,
      itemsRemoved: removedKeys.length,
      itemsSkipped: totalSkippedEmpty,
      snapshotId: snapshot?.id ?? null,
    };
  }

  /**
   * Load incremental sync state for a library from Redis.
   */
  private async getSyncState(
    serverId: string,
    libraryId: string
  ): Promise<{
    lastSyncedAt: Date | null;
    lastItemCount: number | null;
    syncCycle: number;
    acceptedShortfall: number;
  }> {
    if (!redisClient)
      return { lastSyncedAt: null, lastItemCount: null, syncCycle: 0, acceptedShortfall: 0 };

    const [lastStr, countStr, cycleStr, shortfallStr] = await Promise.all([
      redisClient.get(REDIS_KEYS.LIBRARY_SYNC_LAST(serverId, libraryId)),
      redisClient.get(REDIS_KEYS.LIBRARY_SYNC_COUNT(serverId, libraryId)),
      redisClient.get(REDIS_KEYS.LIBRARY_SYNC_CYCLE(serverId, libraryId)),
      redisClient.get(REDIS_KEYS.LIBRARY_SYNC_SHORTFALL(serverId, libraryId)),
    ]);

    return {
      lastSyncedAt: lastStr ? new Date(lastStr) : null,
      lastItemCount: countStr ? parseInt(countStr, 10) : null,
      syncCycle: cycleStr ? parseInt(cycleStr, 10) : 0,
      acceptedShortfall: shortfallStr ? parseInt(shortfallStr, 10) : 0,
    };
  }

  /**
   * Persist incremental sync state for a library to Redis.
   * Stores the current time minus a safety margin so items added during sync
   * are not missed on the next incremental run.
   * acceptedShortfall is omitted unless a full scan just recomputed it, leaving the prior baseline in place.
   */
  private async saveSyncState(
    serverId: string,
    libraryId: string,
    itemCount: number,
    syncCycle: number,
    acceptedShortfall?: number
  ): Promise<void> {
    if (!redisClient) return;

    const safeTimestamp = new Date(Date.now() - SYNC_SAFETY_MARGIN_MS).toISOString();

    const writes = [
      redisClient.set(
        REDIS_KEYS.LIBRARY_SYNC_LAST(serverId, libraryId),
        safeTimestamp,
        'EX',
        SYNC_STATE_TTL
      ),
      redisClient.set(
        REDIS_KEYS.LIBRARY_SYNC_COUNT(serverId, libraryId),
        String(itemCount),
        'EX',
        SYNC_STATE_TTL
      ),
      redisClient.set(
        REDIS_KEYS.LIBRARY_SYNC_CYCLE(serverId, libraryId),
        String(syncCycle),
        'EX',
        SYNC_STATE_TTL
      ),
    ];
    if (acceptedShortfall !== undefined) {
      writes.push(
        redisClient.set(
          REDIS_KEYS.LIBRARY_SYNC_SHORTFALL(serverId, libraryId),
          String(acceptedShortfall),
          'EX',
          SYNC_STATE_TTL
        )
      );
    }
    await Promise.all(writes);
  }

  /** Post-full-scan gap versus server total is now authoritative - record it as the new accepted shortfall baseline. */
  private async computeAcceptedShortfall(
    serverId: string,
    libraryId: string,
    totalCount: number,
    isMusicLibrary: boolean,
    triggeredBy: 'manual' | 'scheduled',
    previousShortfall: number
  ): Promise<number | undefined> {
    // Manual and music syncs never read this baseline, so skip the extra query.
    if (isMusicLibrary || triggeredBy === 'manual') return undefined;
    // Best-effort: a failure here must not fail a sync that already succeeded.
    try {
      const postScanActiveCount = await this.getActiveItemCount(serverId, libraryId);
      const newShortfall = Math.max(0, totalCount - postScanActiveCount);
      const driftTolerance = Math.max(
        COUNT_MISMATCH_MIN_TOLERANCE,
        Math.ceil(totalCount * COUNT_MISMATCH_RATIO)
      );
      if (Math.abs(newShortfall - previousShortfall) > driftTolerance) {
        console.warn(
          `[LibrarySync] Accepted shortfall baseline for library ${libraryId} drifted from ${previousShortfall} to ${newShortfall} (tolerance ${driftTolerance})`
        );
      }
      return newShortfall;
    } catch (err) {
      console.warn(
        `[LibrarySync] Failed to compute accepted shortfall for library ${libraryId}, leaving previous baseline in place:`,
        err
      );
      return undefined;
    }
  }

  /**
   * Upsert items to libraryItems table
   *
   * Uses Drizzle's onConflictDoUpdate for atomic bulk upserts.
   * Conflict target: serverId + ratingKey
   * Wrapped in transaction for atomicity - partial failures will rollback.
   */
  async upsertItems(
    serverId: string,
    libraryId: string,
    items: MediaLibraryItem[],
    touchedMediaIds?: Set<string>
  ): Promise<{ skippedEmpty: number; collapsedDuplicates: number }> {
    if (items.length === 0) return { skippedEmpty: 0, collapsedDuplicates: 0 };

    let skippedEmpty = 0;
    const deduped = new Map<string, MediaLibraryItem>();
    for (const item of items) {
      if (!item.ratingKey) {
        skippedEmpty++;
        continue;
      }
      deduped.set(item.ratingKey, item);
    }
    const uniqueItems = Array.from(deduped.values());
    const collapsedDuplicates = items.length - skippedEmpty - uniqueItems.length;

    if (skippedEmpty > 0) {
      console.warn(
        `[LibrarySync] Dropped ${skippedEmpty} item(s) with empty rating_key ` +
          `for server ${serverId} library ${libraryId}`
      );
    }
    if (collapsedDuplicates > 0) {
      console.warn(
        `[LibrarySync] Collapsed ${collapsedDuplicates} duplicate rating_key(s) ` +
          `for server ${serverId} library ${libraryId} (${items.length} → ${uniqueItems.length})`
      );
    }

    if (uniqueItems.length === 0) return { skippedEmpty, collapsedDuplicates };

    const mediaIdByRatingKey = await resolveMediaBatch(
      uniqueItems.map((item) => ({
        mediaType: item.mediaType,
        imdbId: item.imdbId ?? null,
        tmdbId: item.tmdbId ?? null,
        tvdbId: item.tvdbId ?? null,
        musicBrainzId: item.musicBrainzId ?? null,
        title: item.title,
        year: item.year ?? null,
        serverId,
        ratingKey: item.ratingKey,
        grandparentRatingKey: item.grandparentRatingKey ?? null,
        parentRatingKey: item.parentRatingKey ?? null,
        grandparentTitle: item.grandparentTitle ?? null,
        parentTitle: item.parentTitle ?? null,
        seasonNumber: item.parentIndex ?? null,
        episodeNumber: item.itemIndex ?? null,
      }))
    );

    // Bulk upsert with transaction for atomicity
    await db.transaction(async (tx) => {
      const changedRows = await tx
        .insert(libraryItems)
        .values(
          uniqueItems.map((item) => {
            // Defensive: ensure addedAt is a valid Date before passing to Drizzle.
            // An Invalid Date object (from malformed API data) would crash toISOString()
            let createdAt = item.addedAt;
            if (!(createdAt instanceof Date) || isNaN(createdAt.getTime())) {
              console.warn(
                `[LibrarySync] Invalid addedAt for item "${item.title}" (${item.ratingKey}), using current time`
              );
              createdAt = new Date();
            }

            return scrubStringFields({
              serverId,
              libraryId,
              ratingKey: item.ratingKey,
              title: item.title,
              mediaType: item.mediaType,
              year: item.year ?? null,
              imdbId: item.imdbId ?? null,
              tmdbId: item.tmdbId ?? null,
              tvdbId: item.tvdbId ?? null,
              videoResolution: item.videoResolution ?? null,
              videoCodec: item.videoCodec ?? null,
              videoDynamicRange: item.videoDynamicRange ?? null,
              audioCodec: item.audioCodec ?? null,
              audioChannels: item.audioChannels ?? null,
              fileSize: item.fileSize ?? null,
              versionCount: item.versions?.length ?? 0,
              versionsFingerprint: item.versionsFingerprint ?? null,
              filePath: item.filePath ?? null,
              // Hierarchy fields (for episodes and tracks)
              grandparentTitle: item.grandparentTitle ?? null,
              grandparentRatingKey: item.grandparentRatingKey ?? null,
              parentTitle: item.parentTitle ?? null,
              parentRatingKey: item.parentRatingKey ?? null,
              parentIndex: item.parentIndex ?? null,
              itemIndex: item.itemIndex ?? null,
              mediaId: mediaIdByRatingKey.get(item.ratingKey) ?? null,
              genres: item.genres ?? null,
              thumbPath: item.thumbPath ?? null,
              removedAt: null,
              createdAt,
            });
          })
        )
        .onConflictDoUpdate({
          target: [libraryItems.serverId, libraryItems.ratingKey],
          set: {
            libraryId,
            title: sql`excluded.title`,
            mediaType: sql`excluded.media_type`,
            year: sql`excluded.year`,
            imdbId: sql`excluded.imdb_id`,
            tmdbId: sql`excluded.tmdb_id`,
            tvdbId: sql`excluded.tvdb_id`,
            videoResolution: sql`excluded.video_resolution`,
            videoCodec: sql`excluded.video_codec`,
            videoDynamicRange: sql`excluded.video_dynamic_range`,
            audioCodec: sql`excluded.audio_codec`,
            audioChannels: sql`excluded.audio_channels`,
            fileSize: sql`excluded.file_size`,
            versionCount: sql`excluded.version_count`,
            versionsFingerprint: sql`excluded.versions_fingerprint`,
            filePath: sql`excluded.file_path`,
            // Hierarchy fields (for episodes and tracks)
            grandparentTitle: sql`excluded.grandparent_title`,
            grandparentRatingKey: sql`excluded.grandparent_rating_key`,
            parentTitle: sql`excluded.parent_title`,
            parentRatingKey: sql`excluded.parent_rating_key`,
            parentIndex: sql`excluded.parent_index`,
            itemIndex: sql`excluded.item_index`,
            mediaId: sql`excluded.media_id`,
            genres: sql`excluded.genres`,
            // Re-synced posters must update; dominant_color is write-once by the image
            // pipeline and deliberately excluded so a sync never nulls or overwrites it.
            thumbPath: sql`excluded.thumb_path`,
            removedAt: null,
            // Fix created_at with Plex's addedAt (for existing items with wrong dates)
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
          // A full scan revisits every item every cycle even when nothing on the
          // server changed - without this guard that rewrites all ~40k rows every
          // time (dead tuples, WAL, index churn) just like the m.genres guard
          // below. Only fire the update when a tracked column would actually
          // change, or when reviving a tombstoned row (removed_at was set).
          // No consumer reads library_items.updated_at as a change signal, so
          // leaving it un-bumped on a no-op conflict is safe. dominant_color
          // is excluded from `set` above, so it's excluded from this comparison too.
          setWhere: sql`
            ${libraryItems.libraryId} IS DISTINCT FROM excluded.library_id OR
            ${libraryItems.title} IS DISTINCT FROM excluded.title OR
            ${libraryItems.mediaType} IS DISTINCT FROM excluded.media_type OR
            ${libraryItems.year} IS DISTINCT FROM excluded.year OR
            ${libraryItems.imdbId} IS DISTINCT FROM excluded.imdb_id OR
            ${libraryItems.tmdbId} IS DISTINCT FROM excluded.tmdb_id OR
            ${libraryItems.tvdbId} IS DISTINCT FROM excluded.tvdb_id OR
            ${libraryItems.videoResolution} IS DISTINCT FROM excluded.video_resolution OR
            ${libraryItems.videoCodec} IS DISTINCT FROM excluded.video_codec OR
            ${libraryItems.videoDynamicRange} IS DISTINCT FROM excluded.video_dynamic_range OR
            ${libraryItems.audioCodec} IS DISTINCT FROM excluded.audio_codec OR
            ${libraryItems.audioChannels} IS DISTINCT FROM excluded.audio_channels OR
            ${libraryItems.fileSize} IS DISTINCT FROM excluded.file_size OR
            ${libraryItems.versionsFingerprint} IS DISTINCT FROM excluded.versions_fingerprint OR
            ${libraryItems.filePath} IS DISTINCT FROM excluded.file_path OR
            ${libraryItems.grandparentTitle} IS DISTINCT FROM excluded.grandparent_title OR
            ${libraryItems.grandparentRatingKey} IS DISTINCT FROM excluded.grandparent_rating_key OR
            ${libraryItems.parentTitle} IS DISTINCT FROM excluded.parent_title OR
            ${libraryItems.parentRatingKey} IS DISTINCT FROM excluded.parent_rating_key OR
            ${libraryItems.parentIndex} IS DISTINCT FROM excluded.parent_index OR
            ${libraryItems.itemIndex} IS DISTINCT FROM excluded.item_index OR
            ${libraryItems.mediaId} IS DISTINCT FROM excluded.media_id OR
            ${libraryItems.genres} IS DISTINCT FROM excluded.genres OR
            ${libraryItems.thumbPath} IS DISTINCT FROM excluded.thumb_path OR
            ${libraryItems.createdAt} IS DISTINCT FROM excluded.created_at OR
            ${libraryItems.removedAt} IS NOT NULL
          `,
        })
        // Only inserted/updated rows return; the versions_fingerprint clause
        // above means version-only changes are among them, so the diff below
        // runs exactly for items whose version set may have changed.
        .returning({ id: libraryItems.id, ratingKey: libraryItems.ratingKey });

      if (changedRows.length > 0) {
        await this.reconcileItemVersions(tx, changedRows, deduped);
      }
    });

    const genreRows = uniqueItems
      .filter((i) => i.genres?.length && mediaIdByRatingKey.get(i.ratingKey))
      .map((i) => ({ id: mediaIdByRatingKey.get(i.ratingKey)!, genres: i.genres! }));
    if (genreRows.length > 0) {
      const values = sql.join(
        genreRows.map((r) => sql`(${r.id}::uuid, ${toPgTextArrayLiteral(r.genres)}::text[])`),
        sql`, `
      );
      // m.genres IS NULL writes once so disagreeing servers don't thrash the row
      await db.execute(sql`
        UPDATE media m SET genres = v.genres, updated_at = now()
        FROM (VALUES ${values}) AS v(id, genres)
        WHERE m.id = v.id AND m.genres IS NULL
      `);
    }

    const resolvedIds = uniqueItems.map((i) => mediaIdByRatingKey.get(i.ratingKey));
    if (touchedMediaIds) {
      for (const id of resolvedIds) if (id) touchedMediaIds.add(id);
    } else {
      await this.recomputeLatestAddedAt(resolvedIds);
    }

    return { skippedEmpty, collapsedDuplicates };
  }

  /**
   * Diff child version rows for items whose upsert reported a change.
   * Sentinel placeholders are hard deleted (they describe the same file as
   * one of the real versions replacing them); observed versions upsert with
   * revival; versions absent from the incoming set are tombstoned, never
   * deleted, so upgrade and deletion history survives.
   */
  private async reconcileItemVersions(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    changedRows: Array<{ id: string; ratingKey: string }>,
    itemsByRatingKey: Map<string, MediaLibraryItem>
  ): Promise<void> {
    const itemIds = changedRows.map((r) => r.id);

    await tx
      .delete(libraryItemVersions)
      .where(
        and(
          inArray(libraryItemVersions.libraryItemId, itemIds),
          eq(libraryItemVersions.serverVersionKey, LEGACY_VERSION_SENTINEL)
        )
      );

    const now = new Date();
    const seen = new Set<string>();
    const versionRows: Array<typeof libraryItemVersions.$inferInsert> = [];
    for (const row of changedRows) {
      for (const version of itemsByRatingKey.get(row.ratingKey)?.versions ?? []) {
        const dedupeKey = `${row.id}:${version.serverVersionKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        versionRows.push({
          libraryItemId: row.id,
          serverVersionKey: version.serverVersionKey,
          videoResolution: version.videoResolution ?? null,
          videoCodec: version.videoCodec ?? null,
          videoDynamicRange: version.videoDynamicRange ?? null,
          audioCodec: version.audioCodec ?? null,
          audioChannels: version.audioChannels ?? null,
          container: version.container ?? null,
          bitrate: version.bitrate ?? null,
          fileSize: version.fileSize ?? null,
          partCount: version.partCount,
          filePath: version.filePath ?? null,
          removedAt: null,
          updatedAt: now,
        });
      }
    }

    if (versionRows.length > 0) {
      await tx
        .insert(libraryItemVersions)
        .values(versionRows)
        .onConflictDoUpdate({
          target: [libraryItemVersions.libraryItemId, libraryItemVersions.serverVersionKey],
          set: {
            videoResolution: sql`excluded.video_resolution`,
            videoCodec: sql`excluded.video_codec`,
            videoDynamicRange: sql`excluded.video_dynamic_range`,
            audioCodec: sql`excluded.audio_codec`,
            audioChannels: sql`excluded.audio_channels`,
            container: sql`excluded.container`,
            bitrate: sql`excluded.bitrate`,
            fileSize: sql`excluded.file_size`,
            partCount: sql`excluded.part_count`,
            filePath: sql`excluded.file_path`,
            // Revival: a restored file reuses its row and keeps first_seen_at
            removedAt: null,
            updatedAt: now,
          },
        });
    }

    const keepPairs = versionRows.map(
      (row) => sql`(${row.libraryItemId}::uuid, ${row.serverVersionKey})`
    );
    await tx
      .update(libraryItemVersions)
      .set({ removedAt: now, updatedAt: now })
      .where(
        and(
          inArray(libraryItemVersions.libraryItemId, itemIds),
          isNull(libraryItemVersions.removedAt),
          keepPairs.length > 0
            ? sql`(${libraryItemVersions.libraryItemId}, ${libraryItemVersions.serverVersionKey}) NOT IN (${sql.join(keepPairs, sql`, `)})`
            : undefined
        )
      );
  }

  /**
   * Refresh media.latest_added_at for the given media ids from their active
   * library_items rows. LEFT JOIN against the full touched-id list so an id with
   * zero active copies left resets to NULL instead of keeping a stale value.
   */
  private async recomputeLatestAddedAt(mediaIds: Array<string | null | undefined>): Promise<void> {
    const uniqueIds = Array.from(new Set(mediaIds.filter((id): id is string => !!id)));
    const CHUNK = 10000;
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const chunk = `{${uniqueIds.slice(i, i + CHUNK).join(',')}}`;
      await db.execute(sql`
        UPDATE media m SET latest_added_at = sub.max_added
        FROM (SELECT unnest(${chunk}::uuid[]) AS media_id) ids
        LEFT JOIN (
          SELECT media_id, MAX(created_at) AS max_added
          FROM library_items
          WHERE removed_at IS NULL AND media_id = ANY(${chunk}::uuid[])
          GROUP BY media_id
        ) sub ON sub.media_id = ids.media_id
        WHERE m.id = ids.media_id AND m.latest_added_at IS DISTINCT FROM sub.max_added
      `);
    }
  }

  /**
   * Create a snapshot record with aggregate statistics.
   * Snapshots are only created if they would be valid (has items AND has storage size).
   * See snapshotValidation.ts for validity criteria.
   */
  async createSnapshot(
    serverId: string,
    libraryId: string,
    items: SnapshotItemInput[]
  ): Promise<{ id: string } | null> {
    // Don't create snapshots for empty libraries
    if (items.length === 0) {
      return null;
    }
    // Calculate quality distribution
    let count4k = 0;
    let count1080p = 0;
    let count720p = 0;
    let countSd = 0;
    let hevcCount = 0;
    let h264Count = 0;
    let av1Count = 0;
    let countHighQuality = 0;
    let versionCount = 0;
    let totalSize = 0;

    // Media type counts
    let movieCount = 0;
    let episodeCount = 0;
    let musicCount = 0;

    // Filter to only items with valid file size to match backfill behavior.
    const validItems = items.filter((item) => item.fileSize && item.fileSize > 0);
    // Shows and seasons are containers with no file of their own, so counting
    // them from validItems would always yield zero - tally from the full set instead.
    const seasonCount = items.filter((item) => item.mediaType === 'season').length;
    const showCount = items.filter((item) => item.mediaType === 'show').length;

    for (const item of validItems) {
      // Overlapping buckets: a title counts once in every bucket it has an
      // active version in, so bucket sums can exceed item_count by design.
      const versions = item.versions?.length
        ? item.versions
        : [{ videoResolution: item.videoResolution, videoCodec: item.videoCodec }];
      const buckets = new Set<string>();
      const codecFamilies = new Set<string>();
      let highQuality = false;
      for (const version of versions) {
        const bucket = resolutionBucket(version.videoResolution);
        if (bucket) buckets.add(bucket);
        const rank = resolutionTierRank(version.videoResolution);
        if (rank !== null && rank >= RESOLUTION_TIERS['1080p']) highQuality = true;
        const codec = version.videoCodec?.toLowerCase();
        if (codec === 'hevc' || codec === 'h265' || codec === 'x265') {
          codecFamilies.add('hevc');
        } else if (codec === 'h264' || codec === 'avc' || codec === 'x264') {
          codecFamilies.add('h264');
        } else if (codec === 'av1') {
          codecFamilies.add('av1');
        }
      }
      if (buckets.has('4k')) count4k++;
      if (buckets.has('1080p')) count1080p++;
      if (buckets.has('720p')) count720p++;
      if (buckets.has('sd')) countSd++;
      if (highQuality) countHighQuality++;
      if (codecFamilies.has('hevc')) hevcCount++;
      if (codecFamilies.has('h264')) h264Count++;
      if (codecFamilies.has('av1')) av1Count++;
      versionCount += item.versions?.length ?? 1;

      // File size
      totalSize += item.fileSize ?? 0;

      // Media type counts
      switch (item.mediaType) {
        case 'movie':
          movieCount++;
          break;
        case 'episode':
          episodeCount++;
          break;
        case 'artist':
        case 'album':
        case 'track':
          musicCount++;
          break;
      }
    }

    return this.writeSnapshot(serverId, libraryId, {
      itemCount: validItems.length,
      totalSize,
      movieCount,
      episodeCount,
      seasonCount,
      showCount,
      musicCount,
      count4k,
      count1080p,
      count720p,
      countSd,
      hevcCount,
      h264Count,
      av1Count,
      countHighQuality,
      versionCount,
    });
  }

  /**
   * Upsert today's snapshot row from precomputed stats. Shared by
   * createSnapshot (in-memory items, full scan) and rebuildSnapshotFromDb
   * (SQL aggregate, incremental syncs).
   */
  private async writeSnapshot(
    serverId: string,
    libraryId: string,
    stats: SnapshotStats
  ): Promise<{ id: string } | null> {
    // Don't create snapshots with no storage size (invalid per snapshotValidation.ts)
    if (stats.totalSize === 0) {
      return null;
    }

    // Check for existing snapshot today for this library
    // Update it if exists (better data), otherwise insert new
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [existing] = await db
      .select({ id: librarySnapshots.id, itemCount: librarySnapshots.itemCount })
      .from(librarySnapshots)
      .where(
        and(
          eq(librarySnapshots.serverId, serverId),
          eq(librarySnapshots.libraryId, libraryId),
          gte(librarySnapshots.snapshotTime, today),
          lt(librarySnapshots.snapshotTime, tomorrow)
        )
      )
      .limit(1);

    // Update existing snapshot if this one has more/better data, otherwise insert
    // Note: Don't update snapshotTime - TimescaleDB doesn't allow updates that
    // would move a row to a different chunk (causes constraint_1 violation)
    if (existing && stats.itemCount >= existing.itemCount) {
      await db
        .update(librarySnapshots)
        .set({
          ...stats,
          enrichmentPending: stats.itemCount,
          enrichmentComplete: 0,
        })
        .where(eq(librarySnapshots.id, existing.id));
      return { id: existing.id };
    }

    // No existing snapshot today, or existing has more items (don't overwrite with partial data)
    if (existing) {
      return { id: existing.id };
    }

    const [snapshot] = await db
      .insert(librarySnapshots)
      .values({
        serverId,
        libraryId,
        snapshotTime: new Date(),
        ...stats,
        enrichmentPending: stats.itemCount, // Valid items need enrichment
        enrichmentComplete: 0,
      })
      .returning({ id: librarySnapshots.id });
    if (!snapshot) {
      throw new Error('Library snapshot insert returned no row');
    }

    return { id: snapshot.id };
  }

  /**
   * Rebuild a snapshot from current library_items in the database.
   * Used after incremental syncs that added items — the DB has accurate
   * totals after upserts, so we aggregate directly from it.
   */
  private async rebuildSnapshotFromDb(
    serverId: string,
    libraryId: string
  ): Promise<{ id: string } | null> {
    // One aggregate pass in the database - the same item-grain rollup shape
    // the history backfill uses - instead of loading every item and version
    // row of the library into Node just to count buckets. Sentinel rows
    // stand in for items not yet re-scanned.
    const result = await db.execute(sql`
      WITH item_rollup AS (
        SELECT
          li.id,
          li.file_size,
          li.media_type,
          BOOL_OR(${resolutionBucketPredicate('v.video_resolution', '4k')}) AS has_4k,
          BOOL_OR(${resolutionBucketPredicate('v.video_resolution', '1080p')}) AS has_1080p,
          BOOL_OR(${resolutionBucketPredicate('v.video_resolution', '720p')}) AS has_720p,
          BOOL_OR(${resolutionBucketPredicate('v.video_resolution', 'sd')}) AS has_sd,
          BOOL_OR(${resolutionRankSql('v.video_resolution')} >= ${RESOLUTION_TIERS['1080p']}) AS high_quality,
          BOOL_OR(v.video_codec IN ('hevc', 'h265', 'x265', 'HEVC', 'H265', 'X265')) AS has_hevc,
          BOOL_OR(v.video_codec IN ('h264', 'avc', 'x264', 'H264', 'AVC', 'X264')) AS has_h264,
          BOOL_OR(v.video_codec IN ('av1', 'AV1')) AS has_av1,
          COUNT(v.id)::int AS version_cnt
        FROM library_items li
        LEFT JOIN library_item_versions v
          ON v.library_item_id = li.id AND v.removed_at IS NULL
        WHERE li.server_id = ${serverId}
          AND li.library_id = ${libraryId}
          AND li.removed_at IS NULL
        GROUP BY li.id
      )
      SELECT
        COUNT(*) FILTER (WHERE file_size > 0)::int AS item_count,
        COALESCE(SUM(file_size) FILTER (WHERE file_size > 0), 0)::bigint AS total_size,
        COUNT(*) FILTER (WHERE file_size > 0 AND media_type = 'movie')::int AS movie_count,
        COUNT(*) FILTER (WHERE file_size > 0 AND media_type = 'episode')::int AS episode_count,
        COUNT(*) FILTER (WHERE media_type = 'season')::int AS season_count,
        COUNT(*) FILTER (WHERE media_type = 'show')::int AS show_count,
        COUNT(*) FILTER (WHERE file_size > 0 AND media_type IN ('artist', 'album', 'track'))::int AS music_count,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_4k)::int AS count_4k,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_1080p)::int AS count_1080p,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_720p)::int AS count_720p,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_sd)::int AS count_sd,
        COUNT(*) FILTER (WHERE file_size > 0 AND high_quality)::int AS count_high_quality,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_hevc)::int AS hevc_count,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_h264)::int AS h264_count,
        COUNT(*) FILTER (WHERE file_size > 0 AND has_av1)::int AS av1_count,
        COALESCE(SUM(version_cnt) FILTER (WHERE file_size > 0), 0)::int AS version_count
      FROM item_rollup
    `);

    const row = result.rows[0] as
      | {
          item_count: number;
          total_size: string | number;
          movie_count: number;
          episode_count: number;
          season_count: number;
          show_count: number;
          music_count: number;
          count_4k: number;
          count_1080p: number;
          count_720p: number;
          count_sd: number;
          count_high_quality: number;
          hevc_count: number;
          h264_count: number;
          av1_count: number;
          version_count: number;
        }
      | undefined;
    if (!row) return null;

    return this.writeSnapshot(serverId, libraryId, {
      itemCount: row.item_count,
      totalSize: Number(row.total_size),
      movieCount: row.movie_count,
      episodeCount: row.episode_count,
      seasonCount: row.season_count,
      showCount: row.show_count,
      musicCount: row.music_count,
      count4k: row.count_4k,
      count1080p: row.count_1080p,
      count720p: row.count_720p,
      countSd: row.count_sd,
      hevcCount: row.hevc_count,
      h264Count: row.h264_count,
      av1Count: row.av1_count,
      countHighQuality: row.count_high_quality,
      versionCount: row.version_count,
    });
  }

  /**
   * Copy the most recent snapshot to today if one doesn't already exist.
   * Used during incremental syncs when nothing changed — the library stats
   * are identical, but the growth timeline needs a data point for today.
   */
  private async copyLastSnapshot(
    serverId: string,
    libraryId: string
  ): Promise<{ id: string } | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Already have a snapshot today? Nothing to do.
    const [existing] = await db
      .select({ id: librarySnapshots.id })
      .from(librarySnapshots)
      .where(
        and(
          eq(librarySnapshots.serverId, serverId),
          eq(librarySnapshots.libraryId, libraryId),
          gte(librarySnapshots.snapshotTime, today),
          lt(librarySnapshots.snapshotTime, tomorrow)
        )
      )
      .limit(1);

    if (existing) return { id: existing.id };

    // Find the most recent snapshot for this library
    const [latest] = await db
      .select()
      .from(librarySnapshots)
      .where(
        and(eq(librarySnapshots.serverId, serverId), eq(librarySnapshots.libraryId, libraryId))
      )
      .orderBy(desc(librarySnapshots.snapshotTime))
      .limit(1);

    if (!latest) return null;

    // Insert a copy with today's timestamp
    const [copy] = await db
      .insert(librarySnapshots)
      .values({
        serverId,
        libraryId,
        snapshotTime: new Date(),
        itemCount: latest.itemCount,
        totalSize: latest.totalSize,
        movieCount: latest.movieCount,
        episodeCount: latest.episodeCount,
        seasonCount: latest.seasonCount,
        showCount: latest.showCount,
        musicCount: latest.musicCount,
        count4k: latest.count4k,
        count1080p: latest.count1080p,
        count720p: latest.count720p,
        countSd: latest.countSd,
        hevcCount: latest.hevcCount,
        h264Count: latest.h264Count,
        av1Count: latest.av1Count,
        countHighQuality: latest.countHighQuality,
        versionCount: latest.versionCount,
        enrichmentPending: 0,
        enrichmentComplete: latest.enrichmentComplete,
      })
      .returning({ id: librarySnapshots.id });
    if (!copy) {
      throw new Error('Library snapshot copy returned no row');
    }

    return { id: copy.id };
  }

  /**
   * Get server configuration from database
   */
  private async getServer(serverId: string): Promise<{
    id: string;
    name: string;
    type: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr';
    url: string;
    token: string;
    ignoreAnonymousStreams: boolean;
  } | null> {
    const [server] = await db
      .select({
        id: servers.id,
        name: servers.name,
        type: servers.type,
        url: servers.url,
        token: servers.token,
        ignoreAnonymousStreams: servers.ignoreAnonymousStreams,
      })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    return server ?? null;
  }

  /**
   * Cheap COUNT(*) of active (non-tombstoned) items for a library, used by the
   * count-mismatch escalation. Raw SQL (not db.select) so it never disturbs the
   * ordering of the query-builder select calls elsewhere in a sync run.
   */
  private async getActiveItemCount(serverId: string, libraryId: string): Promise<number> {
    // Top-level items only: the server's totalCount for a section counts
    // shows/movies/artists, never their episodes/tracks/seasons, and those
    // leaves share this library_id - counting them here would make the
    // mismatch check fire on every sync of a non-flat library.
    const result = await db.execute(sql`
      SELECT count(*)::int AS count FROM library_items
      WHERE server_id = ${serverId} AND library_id = ${libraryId} AND removed_at IS NULL
        AND media_type NOT IN ('episode', 'track', 'season')
    `);
    const row = result?.rows?.[0] as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Post-sync check: is the local active count short of the server total by more than the accepted shortfall plus tolerance? */
  private async hasUndercountMismatch(
    serverId: string,
    libraryId: string,
    totalCount: number,
    tolerance: number,
    acceptedShortfall: number
  ): Promise<boolean> {
    const postSyncCount = await this.getActiveItemCount(serverId, libraryId);
    return totalCount - postSyncCount - acceptedShortfall > tolerance;
  }

  /**
   * Get existing item keys for a library (for delta detection)
   */
  private async getPreviousItemKeys(serverId: string, libraryId: string): Promise<Set<string>> {
    const rows = await db
      .select({ ratingKey: libraryItems.ratingKey })
      .from(libraryItems)
      .where(
        and(
          eq(libraryItems.serverId, serverId),
          eq(libraryItems.libraryId, libraryId),
          isNull(libraryItems.removedAt)
        )
      );

    return new Set(rows.map((r) => r.ratingKey));
  }

  /**
   * Tombstone items that no longer exist in the library (soft delete)
   */
  async markItemsRemoved(
    serverId: string,
    libraryId: string,
    ratingKeys: string[],
    touchedMediaIds?: Set<string>
  ): Promise<void> {
    if (ratingKeys.length === 0) return;

    // Update in batches to avoid query size limits
    const BATCH_SIZE = 100;
    const removedMediaIds: Array<string | null> = [];
    for (let i = 0; i < ratingKeys.length; i += BATCH_SIZE) {
      const batch = ratingKeys.slice(i, i + BATCH_SIZE);
      const rows = await db.transaction(async (tx) => {
        const updated = await tx
          .update(libraryItems)
          .set({ removedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(libraryItems.serverId, serverId),
              eq(libraryItems.libraryId, libraryId),
              inArray(libraryItems.ratingKey, batch),
              isNull(libraryItems.removedAt)
            )
          )
          .returning({ id: libraryItems.id, mediaId: libraryItems.mediaId });
        await this.tombstoneVersionsForItems(
          tx,
          updated.map((r) => r.id)
        );
        return updated;
      });
      removedMediaIds.push(...rows.map((r) => r.mediaId));
    }

    if (touchedMediaIds) {
      for (const id of removedMediaIds) if (id) touchedMediaIds.add(id);
    } else {
      await this.recomputeLatestAddedAt(removedMediaIds);
    }
  }

  /**
   * Tombstone items by server + rating key alone (no libraryId needed - real-time
   * removal events arrive with only an item id). Self-healing: if the guess is
   * wrong, the next sync's upsert clears removed_at for any item the server
   * still reports, so a bad tombstone never survives past that sync.
   */
  async tombstoneItemsByRatingKey(serverId: string, ratingKeys: string[]): Promise<void> {
    if (ratingKeys.length === 0) return;

    const BATCH_SIZE = 100;
    const touchedMediaIds: Array<string | null> = [];
    for (let i = 0; i < ratingKeys.length; i += BATCH_SIZE) {
      const batch = ratingKeys.slice(i, i + BATCH_SIZE);
      const rows = await db.transaction(async (tx) => {
        const updated = await tx
          .update(libraryItems)
          .set({ removedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(libraryItems.serverId, serverId),
              inArray(libraryItems.ratingKey, batch),
              isNull(libraryItems.removedAt)
            )
          )
          .returning({ id: libraryItems.id, mediaId: libraryItems.mediaId });
        await this.tombstoneVersionsForItems(
          tx,
          updated.map((r) => r.id)
        );
        return updated;
      });
      touchedMediaIds.push(...rows.map((r) => r.mediaId));
    }

    await this.recomputeLatestAddedAt(touchedMediaIds);
  }

  /**
   * Tombstoning an item cascades to its versions; revival happens via the
   * next upsert's version diff, which restores whatever the server reports.
   * Runs inside the caller's item-tombstone transaction and re-checks the
   * parent is still tombstoned: without both, a concurrent sync reviving the
   * item between the two writes would leave an ACTIVE item with zero active
   * versions - and since revival clears the fingerprint trigger, nothing
   * would ever repair it.
   */
  private async tombstoneVersionsForItems(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    itemIds: string[]
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const idList = sql.join(
      itemIds.map((id) => sql`${id}::uuid`),
      sql`, `
    );
    await tx.execute(sql`
      UPDATE library_item_versions v
      SET removed_at = now(), updated_at = now()
      FROM library_items li
      WHERE li.id = v.library_item_id
        AND v.library_item_id IN (${idList})
        AND v.removed_at IS NULL
        AND li.removed_at IS NOT NULL
    `);
  }

  /**
   * Upsert library name/media type for the browse detail page's per-copy
   * breakdown, and drop rows for libraries the server no longer reports.
   * Library names are newly tracked as of this table: copies synced before
   * a server's next sync show no library name until that sync runs.
   */
  private async syncLibraryNames(serverId: string, libraries: MediaLibrary[]): Promise<void> {
    if (libraries.length === 0) return;

    await db
      .insert(librariesTable)
      .values(
        libraries.map((lib) => ({
          serverId,
          libraryId: lib.id,
          name: lib.name,
          mediaType: lib.type,
        }))
      )
      .onConflictDoUpdate({
        target: [librariesTable.serverId, librariesTable.libraryId],
        set: {
          name: sql`excluded.name`,
          mediaType: sql`excluded.media_type`,
          updatedAt: new Date(),
        },
      });

    await db.delete(librariesTable).where(
      and(
        eq(librariesTable.serverId, serverId),
        notInArray(
          librariesTable.libraryId,
          libraries.map((lib) => lib.id)
        )
      )
    );
  }

  /**
   * Detect and remove items/snapshots for libraries that no longer exist on the media server.
   *
   * When users move content between libraries or delete/recreate libraries,
   * items get new IDs and the old libraryId entries become orphans.
   */
  private async cleanupOrphanedLibraries(
    serverId: string,
    currentLibraryIds: Set<string>
  ): Promise<{ removedLibraryIds: string[]; removedItemCount: number }> {
    // Find distinct library IDs that exist in the DB for this server
    const itemLibraryRows = await db
      .selectDistinct({ libraryId: libraryItems.libraryId })
      .from(libraryItems)
      .where(eq(libraryItems.serverId, serverId));

    const snapshotLibraryRows = await db
      .selectDistinct({ libraryId: librarySnapshots.libraryId })
      .from(librarySnapshots)
      .where(eq(librarySnapshots.serverId, serverId));

    // Combine and subtract current library IDs to find orphans
    const allDbLibraryIds = new Set<string>();
    for (const row of itemLibraryRows) allDbLibraryIds.add(row.libraryId);
    for (const row of snapshotLibraryRows) allDbLibraryIds.add(row.libraryId);

    const orphanedIds = [...allDbLibraryIds].filter((id) => !currentLibraryIds.has(id));
    if (orphanedIds.length === 0) {
      return { removedLibraryIds: [], removedItemCount: 0 };
    }

    // Delete orphaned items and snapshots per library.
    const cleanedIds: string[] = [];
    let deletedSnapshots = false;
    let removedItemCount = 0;
    const touchedMediaIds: Array<string | null> = [];

    for (const libraryId of orphanedIds) {
      try {
        // .returning() so the caller can count these rows for cache invalidation - see syncServer.
        const deletedItems = await db
          .delete(libraryItems)
          .where(and(eq(libraryItems.serverId, serverId), eq(libraryItems.libraryId, libraryId)))
          .returning({ id: libraryItems.id, mediaId: libraryItems.mediaId });
        removedItemCount += deletedItems.length;
        touchedMediaIds.push(...deletedItems.map((i) => i.mediaId));

        await db
          .delete(librarySnapshots)
          .where(
            and(eq(librarySnapshots.serverId, serverId), eq(librarySnapshots.libraryId, libraryId))
          );

        cleanedIds.push(libraryId);
        if (snapshotLibraryRows.some((row) => row.libraryId === libraryId)) {
          deletedSnapshots = true;
        }
      } catch (err) {
        console.warn(`[LibrarySync] Failed to clean up orphaned library ${libraryId}:`, err);
      }
    }

    await this.recomputeLatestAddedAt(touchedMediaIds);

    if (deletedSnapshots) {
      try {
        await db.execute(
          sql`CALL refresh_continuous_aggregate('library_stats_daily'::regclass, NULL, NULL)`
        );
        await db.execute(
          sql`CALL refresh_continuous_aggregate('content_quality_daily'::regclass, NULL, NULL)`
        );
      } catch (err) {
        console.warn('[LibrarySync] Failed to refresh aggregates after orphan cleanup:', err);
      }
    }

    return { removedLibraryIds: cleanedIds, removedItemCount };
  }
}

// Export singleton instance
export const librarySyncService = new LibrarySyncService();
