/**
 * Session Deduplication Module
 *
 * Provides two-tier deduplication for import operations:
 * 1. Tier 1: Match by externalSessionId (fast, exact)
 * 2. Tier 2: Match by composite time-based key (fallback for missing external IDs)
 *
 * Used by both Tautulli and Jellystat importers.
 */

import { eq, and, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessions } from '../../db/schema.js';

/**
 * Maximum size for IN clause arrays to prevent PostgreSQL lock exhaustion.
 * TimescaleDB with many chunks can exhaust max_locks_per_transaction when
 * queries have large IN clauses that touch many partitions.
 */
const DEDUP_CHUNK_SIZE = 500;

/**
 * Existing session data needed for deduplication decisions
 */
export interface ExistingSession {
  id: string;
  externalSessionId: string | null;
  ratingKey: string | null;
  startedAt: Date | null;
  serverUserId: string;
  totalDurationMs: number | null;
  stoppedAt: Date | null;
  durationMs: number | null;
  pausedDurationMs: number | null;
  watched: boolean | null;
  sourceVideoCodec: string | null;
  mediaType: string;
  mediaId: string | null;
  showMediaId: string | null;
}

/**
 * Result of deduplication process
 */
export interface DeduplicationResult<T> {
  /** Records that should be inserted (new) */
  toInsert: T[];
  /** Records that should be updated (exist but changed) */
  toUpdate: Array<{ existing: ExistingSession; incoming: T }>;
  /** Count of records skipped (duplicates with no changes) */
  skipped: number;
  /** Count of records that were duplicates (subset of skipped) */
  duplicates: number;
}

/**
 * Configuration for deduplication behavior
 */
export interface DeduplicationConfig<T, TExternalId extends string | number> {
  /** Extract external ID from a record (e.g., Tautulli reference_id, Jellystat Id) */
  getExternalId: (record: T) => TExternalId | null;
  /** Extract time-based key for fallback matching */
  getTimeKey: (record: T) => { serverUserId: string; ratingKey: string; startedAt: Date } | null;
  /** Whether to check for updates on existing records (Tautulli: true, Jellystat: false) */
  allowUpdates?: boolean;
  /** Function to determine if an existing record should be updated */
  shouldUpdate?: (existing: ExistingSession, incoming: T) => boolean;
}

/**
 * Time bounds for limiting chunk scans in TimescaleDB queries.
 * Adding time bounds enables chunk exclusion, dramatically reducing locks.
 */
export interface TimeBounds {
  minTime: Date;
  maxTime: Date;
}

/**
 * Default buffer to add around time bounds (1 day in milliseconds).
 * This handles timezone edge cases and ensures we don't miss matches.
 */
const TIME_BOUNDS_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * Query existing sessions by external IDs
 *
 * Chunks the query to avoid PostgreSQL lock exhaustion with large IN clauses.
 * Each chunk runs in a separate query to minimize lock contention on TimescaleDB.
 *
 * IMPORTANT: Pass timeBounds when available to enable TimescaleDB chunk exclusion.
 * Without time bounds, the query must scan indexes on ALL chunks.
 */
export async function queryExistingByExternalIds(
  serverId: string,
  externalIds: string[],
  timeBounds?: TimeBounds
): Promise<Map<string, ExistingSession>> {
  if (externalIds.length === 0) return new Map();

  const map = new Map<string, ExistingSession>();

  // Add buffer to time bounds for safety
  const minTime = timeBounds
    ? new Date(timeBounds.minTime.getTime() - TIME_BOUNDS_BUFFER_MS)
    : undefined;
  const maxTime = timeBounds
    ? new Date(timeBounds.maxTime.getTime() + TIME_BOUNDS_BUFFER_MS)
    : undefined;

  // Process in chunks to avoid lock exhaustion
  for (let i = 0; i < externalIds.length; i += DEDUP_CHUNK_SIZE) {
    const chunk = externalIds.slice(i, i + DEDUP_CHUNK_SIZE);

    // Build WHERE conditions
    const conditions = [
      eq(sessions.serverId, serverId),
      inArray(sessions.externalSessionId, chunk),
    ];

    // Add time bounds if provided (enables TimescaleDB chunk exclusion)
    if (minTime && maxTime) {
      conditions.push(gte(sessions.startedAt, minTime));
      conditions.push(lte(sessions.startedAt, maxTime));
    }

    const existing = await db
      .select({
        id: sessions.id,
        externalSessionId: sessions.externalSessionId,
        ratingKey: sessions.ratingKey,
        startedAt: sessions.startedAt,
        serverUserId: sessions.serverUserId,
        totalDurationMs: sessions.totalDurationMs,
        stoppedAt: sessions.stoppedAt,
        durationMs: sessions.durationMs,
        pausedDurationMs: sessions.pausedDurationMs,
        watched: sessions.watched,
        sourceVideoCodec: sessions.sourceVideoCodec,
        mediaType: sessions.mediaType,
        mediaId: sessions.mediaId,
        showMediaId: sessions.showMediaId,
      })
      .from(sessions)
      .where(and(...conditions));

    for (const s of existing) {
      if (s.externalSessionId) {
        map.set(s.externalSessionId, s);
      }
    }
  }

  return map;
}

/**
 * Query existing sessions by time-based keys (fallback dedup)
 *
 * Chunks the query to avoid PostgreSQL lock exhaustion with large IN clauses.
 * Uses time bounds derived from keys to enable TimescaleDB chunk exclusion.
 */
export async function queryExistingByTimeKeys(
  serverId: string,
  keys: Array<{ serverUserId: string; ratingKey: string; startedAt: Date }>
): Promise<Map<string, ExistingSession>> {
  if (keys.length === 0) return new Map();

  const map = new Map<string, ExistingSession>();

  // Get unique ratingKeys and serverUserIds
  const uniqueRatingKeys = [...new Set(keys.map((k) => k.ratingKey))];
  const uniqueUserIds = [...new Set(keys.map((k) => k.serverUserId))];

  // Compute time bounds from keys for TimescaleDB chunk exclusion
  // Add buffer to handle timezone/precision edge cases
  const TIME_BUFFER_MS = 60_000; // 1 minute buffer
  const timestamps = keys.map((k) => k.startedAt.getTime());
  const minTime = new Date(Math.min(...timestamps) - TIME_BUFFER_MS);
  const maxTime = new Date(Math.max(...timestamps) + TIME_BUFFER_MS);

  // Process ratingKeys in chunks to avoid lock exhaustion
  // (serverUserIds is typically much smaller, so we don't chunk it)
  for (let i = 0; i < uniqueRatingKeys.length; i += DEDUP_CHUNK_SIZE) {
    const ratingKeyChunk = uniqueRatingKeys.slice(i, i + DEDUP_CHUNK_SIZE);

    // Build a query that matches on ratingKey, serverUserId, and time bounds
    // Then we filter by startedAt in memory for exact time matching
    const existing = await db
      .select({
        id: sessions.id,
        externalSessionId: sessions.externalSessionId,
        ratingKey: sessions.ratingKey,
        startedAt: sessions.startedAt,
        serverUserId: sessions.serverUserId,
        totalDurationMs: sessions.totalDurationMs,
        stoppedAt: sessions.stoppedAt,
        durationMs: sessions.durationMs,
        pausedDurationMs: sessions.pausedDurationMs,
        watched: sessions.watched,
        sourceVideoCodec: sessions.sourceVideoCodec,
        mediaType: sessions.mediaType,
        mediaId: sessions.mediaId,
        showMediaId: sessions.showMediaId,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.serverId, serverId),
          inArray(sessions.ratingKey, ratingKeyChunk),
          inArray(sessions.serverUserId, uniqueUserIds),
          // Time bounds enable TimescaleDB chunk exclusion
          gte(sessions.startedAt, minTime),
          lte(sessions.startedAt, maxTime)
        )
      );

    for (const s of existing) {
      if (s.ratingKey && s.serverUserId && s.startedAt) {
        const timeKey = `${s.serverUserId}:${s.ratingKey}:${s.startedAt.getTime()}`;
        map.set(timeKey, s);
      }
    }
  }

  return map;
}

/**
 * Create a time-based key string from components
 */
export function createTimeKey(serverUserId: string, ratingKey: string, startedAt: Date): string {
  return `${serverUserId}:${ratingKey}:${startedAt.getTime()}`;
}

/**
 * Deduplicate a batch of records against existing sessions
 *
 * @param serverId - The server ID to scope the dedup query
 * @param records - The records to deduplicate
 * @param config - Configuration for how to extract IDs and handle updates
 * @param insertedThisRun - Set of external IDs already inserted in this import run
 */
export async function deduplicateBatch<T, TExternalId extends string | number>(
  serverId: string,
  records: T[],
  config: DeduplicationConfig<T, TExternalId>,
  insertedThisRun: Set<string>
): Promise<DeduplicationResult<T>> {
  const result: DeduplicationResult<T> = {
    toInsert: [],
    toUpdate: [],
    skipped: 0,
    duplicates: 0,
  };

  if (records.length === 0) return result;

  // Collect external IDs for batch query
  const externalIds: string[] = [];
  const timeKeys: Array<{ serverUserId: string; ratingKey: string; startedAt: Date }> = [];

  for (const record of records) {
    const externalId = config.getExternalId(record);
    if (externalId !== null) {
      externalIds.push(String(externalId));
    }

    const timeKeyData = config.getTimeKey(record);
    if (timeKeyData) {
      timeKeys.push(timeKeyData);
    }
  }

  // Query existing sessions in batches
  const sessionByExternalId = await queryExistingByExternalIds(serverId, externalIds);
  const sessionByTimeKey = await queryExistingByTimeKeys(serverId, timeKeys);

  // Process each record
  for (const record of records) {
    const externalId = config.getExternalId(record);
    const externalIdStr = externalId !== null ? String(externalId) : null;

    // Check if already inserted in this import run
    if (externalIdStr && insertedThisRun.has(externalIdStr)) {
      result.skipped++;
      result.duplicates++;
      continue;
    }

    // Check by external ID first
    if (externalIdStr) {
      const existing = sessionByExternalId.get(externalIdStr);
      if (existing) {
        if (config.allowUpdates && config.shouldUpdate?.(existing, record)) {
          result.toUpdate.push({ existing, incoming: record });
        } else {
          result.skipped++;
          result.duplicates++;
        }
        continue;
      }
    }

    // Fallback: check by time-based key
    const timeKeyData = config.getTimeKey(record);
    if (timeKeyData) {
      const timeKeyStr = createTimeKey(
        timeKeyData.serverUserId,
        timeKeyData.ratingKey,
        timeKeyData.startedAt
      );
      const existing = sessionByTimeKey.get(timeKeyStr);
      if (existing) {
        if (config.allowUpdates && config.shouldUpdate?.(existing, record)) {
          result.toUpdate.push({ existing, incoming: record });
        } else {
          result.skipped++;
          result.duplicates++;
        }
        continue;
      }
    }

    // No match found - this is a new record
    result.toInsert.push(record);
    if (externalIdStr) {
      insertedThisRun.add(externalIdStr);
    }
  }

  return result;
}

/**
 * Create a deduplication context for an import operation
 *
 * This provides a convenient wrapper that manages the insertedThisRun set
 * and provides batch-by-batch deduplication.
 */
export function createDeduplicationContext<T, TExternalId extends string | number>(
  serverId: string,
  config: DeduplicationConfig<T, TExternalId>
) {
  const insertedThisRun = new Set<string>();

  return {
    /**
     * Deduplicate a batch of records
     */
    async deduplicate(records: T[]): Promise<DeduplicationResult<T>> {
      return deduplicateBatch(serverId, records, config, insertedThisRun);
    },

    /**
     * Get the set of IDs inserted in this import run
     */
    getInsertedIds(): Set<string> {
      return insertedThisRun;
    },

    /**
     * Mark an ID as inserted (for manual tracking)
     */
    markInserted(externalId: string): void {
      insertedThisRun.add(externalId);
    },
  };
}
