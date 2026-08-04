/**
 * Library Duplicates Route
 *
 * GET /duplicates - Duplicate detection across servers, across libraries on
 * one server, and across the versions of a single item.
 *
 * Matching hierarchy (confidence scores):
 * 1. IMDB ID match: 100%
 * 2. TMDB ID match: 95% (items without IMDB)
 * 3. TVDB ID match: 90% (items without IMDB/TMDB)
 * 4. Fuzzy title match: 60-100% (items without any external IDs)
 * 5. Version groups: 100% (one item, several physical files)
 *
 * Mirrors are not duplicates: the same physical file indexed by several
 * libraries or servers (equal byte size, the same heuristic the storage
 * totals use) counts once in group storage and contributes zero reclaimable
 * bytes. Reclaimable = deduped total minus the best-quality file, i.e. what
 * deleting everything except the copy worth keeping frees.
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  REDIS_KEYS,
  CACHE_TTL,
  libraryDuplicatesQuerySchema,
  resolutionTierRank,
  type LibraryDuplicatesQueryInput,
  type MatchType,
  type DuplicateItem,
  type DuplicateItemVersion,
  type DuplicateGroup,
  type DuplicatesSummary,
  type DuplicatesResponse,
} from '@tracearr/shared';
import { db } from '../../db/client.js';
import {
  validateServerAccess,
  resolveServerIds,
  buildMultiServerFragment,
} from '../../utils/serverFiltering.js';
import { buildLibraryCacheKey } from './utils.js';

/** Raw match row from database */
interface RawMatchRow {
  match_key: string;
  match_type: MatchType;
  confidence: number;
  server_ids: string[];
  item_ids: string[];
  server_count: number;
}

/** Raw fuzzy match row from database */
interface RawFuzzyRow {
  item_a_id: string;
  item_b_id: string;
  server_a_id: string;
  server_b_id: string;
  title_a: string;
  title_b: string;
  confidence: number;
}

/** Raw item details row */
interface ItemDetailsRow {
  id: string;
  server_id: string;
  server_name: string;
  library_id: string | null;
  library_name: string | null;
  title: string;
  year: number | null;
  media_type: string;
  file_size: string | null;
  video_resolution: string | null;
}

interface VersionRow {
  library_item_id: string;
  video_resolution: string | null;
  video_codec: string | null;
  file_size: string | null;
  file_path: string | null;
}

interface GroupFile {
  itemId: string;
  resolution: string | null;
  fileSize: number | null;
  filePath: string | null;
}

/**
 * Mirror-deduped storage math over every physical file in a group.
 * Equal byte size means the same physical file (the codebase-wide
 * heuristic, matching dedupedStorageBytesSql's totals); it applies wherever
 * the repeat appears - another item, another library, or a second listing
 * under the same item. The best-quality distinct file is the keeper.
 * mirrorFlags is parallel to the input: true where a file repeats one
 * already counted.
 */
function computeGroupStorage(files: GroupFile[]): {
  totalStorageBytes: number;
  potentialSavingsBytes: number;
  uniqueFileCount: number;
  mirrorFlags: boolean[];
} {
  const seenSizes = new Set<number>();
  const distinct: GroupFile[] = [];
  const mirrorFlags: boolean[] = [];
  for (const file of files) {
    if (file.fileSize === null) {
      mirrorFlags.push(false);
      continue;
    }
    if (seenSizes.has(file.fileSize)) {
      mirrorFlags.push(true);
      continue;
    }
    seenSizes.add(file.fileSize);
    mirrorFlags.push(false);
    distinct.push(file);
  }
  if (distinct.length === 0) {
    return { totalStorageBytes: 0, potentialSavingsBytes: 0, uniqueFileCount: 0, mirrorFlags };
  }

  let total = 0;
  let best: GroupFile | null = null;
  for (const file of distinct) {
    total += file.fileSize!;
    if (
      best === null ||
      (resolutionTierRank(file.resolution) ?? 0) - (resolutionTierRank(best.resolution) ?? 0) > 0 ||
      ((resolutionTierRank(file.resolution) ?? 0) === (resolutionTierRank(best.resolution) ?? 0) &&
        file.fileSize! > best.fileSize!)
    ) {
      best = file;
    }
  }
  return {
    totalStorageBytes: total,
    potentialSavingsBytes: Math.max(0, total - (best?.fileSize ?? 0)),
    uniqueFileCount: distinct.length,
    mirrorFlags,
  };
}

export const libraryDuplicatesRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: LibraryDuplicatesQueryInput }>(
    '/duplicates',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = libraryDuplicatesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }

      const {
        serverId,
        serverIds: rawServerIds,
        mediaType,
        minConfidence,
        includeFuzzy,
        page,
        pageSize,
      } = query.data;
      const authUser = request.user;

      // Validate single-server access when serverId explicitly requested
      if (serverId) {
        const error = validateServerAccess(authUser, serverId);
        if (error) {
          return reply.forbidden(error);
        }
      }

      const resolvedIds = resolveServerIds(authUser, undefined, rawServerIds);

      // Build cache key with all varying params. serverId here is an involvement
      // filter (HAVING), not the scope filter, so it must be a separate segment
      // from resolvedIds or two differently-scoped users requesting the same
      // involvement filter would collide.
      const serverCacheSegment = resolvedIds ? resolvedIds.slice().sort().join(',') : 'all';
      const cacheKey = buildLibraryCacheKey(
        REDIS_KEYS.LIBRARY_DUPLICATES,
        `${serverCacheSegment}:${serverId ?? 'any'}`,
        `${mediaType ?? 'all'}-${minConfidence}-${includeFuzzy}-${page}-${pageSize}`
      );

      // Try cache first
      const cached = await app.redis.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as DuplicatesResponse;
        } catch {
          // Fall through to compute
        }
      }

      // resolvedIds already intersects user access with any requested serverIds
      const serverFilterSql = buildMultiServerFragment(resolvedIds);

      // Optional media type filter
      const mediaTypeFilter = mediaType ? sql`AND media_type = ${mediaType}` : sql``;

      // Involvement filter: with a serverId, groups involving that server;
      // else any group with more than one copy. Same-server (cross-library)
      // groups qualify - COUNT(*), never COUNT(DISTINCT server_id), or they
      // become invisible
      const serverInvolvementFilter = serverId
        ? sql`HAVING ${serverId} = ANY(array_agg(DISTINCT server_id))`
        : sql`HAVING COUNT(*) > 1`;

      // Query for ID-based matches using CTEs with cascading exclusion
      const idMatchesResult = await db.execute(sql`
        WITH imdb_matches AS (
          SELECT
            imdb_id AS match_key,
            'imdb'::text AS match_type,
            100 AS confidence,
            array_agg(DISTINCT server_id) AS server_ids,
            array_agg(id ORDER BY server_id) AS item_ids,
            COUNT(DISTINCT server_id) AS server_count
          FROM library_items
          WHERE imdb_id IS NOT NULL
            AND removed_at IS NULL
            AND media_type != 'season'
            ${serverFilterSql}
            ${mediaTypeFilter}
          GROUP BY imdb_id
          ${serverInvolvementFilter}
        ),
        tmdb_matches AS (
          SELECT
            tmdb_id::text AS match_key,
            'tmdb'::text AS match_type,
            95 AS confidence,
            array_agg(DISTINCT server_id) AS server_ids,
            array_agg(id ORDER BY server_id) AS item_ids,
            COUNT(DISTINCT server_id) AS server_count
          FROM library_items
          WHERE tmdb_id IS NOT NULL
            AND removed_at IS NULL
            AND imdb_id IS NULL  -- Only items not already matched by IMDB
            AND media_type != 'season'
            ${serverFilterSql}
            ${mediaTypeFilter}
          GROUP BY tmdb_id
          ${serverInvolvementFilter}
        ),
        tvdb_matches AS (
          SELECT
            tvdb_id::text AS match_key,
            'tvdb'::text AS match_type,
            90 AS confidence,
            array_agg(DISTINCT server_id) AS server_ids,
            array_agg(id ORDER BY server_id) AS item_ids,
            COUNT(DISTINCT server_id) AS server_count
          FROM library_items
          WHERE tvdb_id IS NOT NULL
            AND removed_at IS NULL
            AND imdb_id IS NULL
            AND tmdb_id IS NULL
            AND media_type != 'season'
            ${serverFilterSql}
            ${mediaTypeFilter}
          GROUP BY tvdb_id
          ${serverInvolvementFilter}
        ),
        all_matches AS (
          SELECT * FROM imdb_matches
          UNION ALL
          SELECT * FROM tmdb_matches
          UNION ALL
          SELECT * FROM tvdb_matches
        )
        SELECT * FROM all_matches
        WHERE confidence >= ${minConfidence}
        ORDER BY confidence DESC, match_type
      `);

      const idMatches = idMatchesResult.rows as unknown as RawMatchRow[];

      // One-item version groups: a single title carrying several physical
      // files (the Plex merged-versions / JF grouped-versions shape)
      const versionInvolvementFilter = serverId ? sql`AND server_id = ${serverId}` : sql``;
      const versionGroupsResult = await db.execute(sql`
        SELECT id, server_id
        FROM library_items
        WHERE version_count > 1
          AND removed_at IS NULL
          AND media_type != 'season'
          ${serverFilterSql}
          ${mediaTypeFilter}
          ${versionInvolvementFilter}
        ORDER BY id
      `);
      const versionGroupRows = versionGroupsResult.rows as unknown as Array<{
        id: string;
        server_id: string;
      }>;

      // Fuzzy matching query (only if includeFuzzy=true)
      let fuzzyMatches: RawFuzzyRow[] = [];
      if (includeFuzzy && minConfidence <= 70) {
        // Build server filter for fuzzy query (applied to both sides of the self-join)
        const fuzzyServerFilterA = buildMultiServerFragment(resolvedIds, 'a.server_id');
        const fuzzyServerFilterB = buildMultiServerFragment(resolvedIds, 'b.server_id');

        // Fuzzy match for items without external IDs. Same-server pairs are
        // duplicates too (unmerged double-imports in one or two libraries).
        const fuzzyResult = await db.execute(sql`
          SELECT
            a.id AS item_a_id,
            b.id AS item_b_id,
            a.server_id AS server_a_id,
            b.server_id AS server_b_id,
            a.title AS title_a,
            b.title AS title_b,
            ROUND(similarity(a.title, b.title) * 100)::int AS confidence
          FROM library_items a
          JOIN library_items b ON a.id < b.id  -- Avoid duplicate pairs
          WHERE a.removed_at IS NULL
            AND b.removed_at IS NULL
            AND a.media_type = b.media_type  -- Same media type
            AND a.media_type != 'season'
            AND a.year = b.year  -- Same year (reduces false positives)
            AND similarity(a.title, b.title) >= 0.6  -- 60% threshold
            AND a.imdb_id IS NULL AND a.tmdb_id IS NULL AND a.tvdb_id IS NULL
            AND b.imdb_id IS NULL AND b.tmdb_id IS NULL AND b.tvdb_id IS NULL
            ${fuzzyServerFilterA}
            ${fuzzyServerFilterB}
            ${mediaType ? sql`AND a.media_type = ${mediaType}` : sql``}
          ORDER BY confidence DESC
          LIMIT 100
        `);
        fuzzyMatches = fuzzyResult.rows as unknown as RawFuzzyRow[];
      }

      // Collect all unique item IDs
      const allItemIds = new Set<string>();
      for (const match of idMatches) {
        for (const id of match.item_ids) {
          allItemIds.add(id);
        }
      }
      for (const row of versionGroupRows) {
        allItemIds.add(row.id);
      }
      for (const fuzzy of fuzzyMatches) {
        allItemIds.add(fuzzy.item_a_id);
        allItemIds.add(fuzzy.item_b_id);
      }

      // Fetch item details and their physical files
      const itemDetailsMap = new Map<string, ItemDetailsRow>();
      const versionsByItem = new Map<string, DuplicateItemVersion[]>();
      if (allItemIds.size > 0) {
        const itemIdArray = Array.from(allItemIds);
        const itemIdsSql = itemIdArray.map((id) => sql`${id}`);

        const itemsResult = await db.execute(sql`
          SELECT
            li.id,
            li.server_id,
            s.name AS server_name,
            li.library_id,
            l.name AS library_name,
            li.title,
            li.year,
            li.media_type,
            li.file_size::text AS file_size,
            li.video_resolution
          FROM library_items li
          JOIN servers s ON li.server_id = s.id
          LEFT JOIN libraries l ON l.server_id = li.server_id AND l.library_id = li.library_id
          WHERE li.id IN (${sql.join(itemIdsSql, sql`, `)})
            AND li.removed_at IS NULL
        `);

        for (const row of itemsResult.rows as unknown as ItemDetailsRow[]) {
          itemDetailsMap.set(row.id, row);
        }

        // Sentinel rows count too: they carry the real file's size and path
        // for items not yet re-scanned into observed versions
        const versionsResult = await db.execute(sql`
          SELECT
            library_item_id,
            video_resolution,
            video_codec,
            file_size::text AS file_size,
            file_path
          FROM library_item_versions
          WHERE library_item_id IN (${sql.join(itemIdsSql, sql`, `)})
            AND removed_at IS NULL
          ORDER BY file_size DESC NULLS LAST
        `);
        for (const row of versionsResult.rows as unknown as VersionRow[]) {
          const list = versionsByItem.get(row.library_item_id) ?? [];
          list.push({
            resolution: row.video_resolution,
            videoCodec: row.video_codec,
            fileSize: row.file_size ? parseInt(row.file_size, 10) : null,
            filePath: row.file_path,
          });
          versionsByItem.set(row.library_item_id, list);
        }
      }

      const toDuplicateItem = (details: ItemDetailsRow): DuplicateItem => ({
        id: details.id,
        serverId: details.server_id,
        serverName: details.server_name,
        libraryId: details.library_id,
        libraryName: details.library_name,
        title: details.title,
        year: details.year,
        mediaType: details.media_type,
        fileSize: details.file_size ? parseInt(details.file_size, 10) : null,
        resolution: details.video_resolution,
        versions: versionsByItem.get(details.id) ?? [],
      });

      /** Every physical file across the group's items, for the storage math */
      const groupFiles = (items: DuplicateItem[]): GroupFile[] =>
        items.flatMap((item) =>
          item.versions.length > 0
            ? item.versions.map((v) => ({
                itemId: item.id,
                resolution: v.resolution,
                fileSize: v.fileSize,
                filePath: v.filePath,
              }))
            : [
                {
                  itemId: item.id,
                  resolution: item.resolution,
                  fileSize: item.fileSize,
                  filePath: null,
                },
              ]
        );

      const buildGroup = (
        matchKey: string,
        matchType: MatchType,
        confidence: number,
        items: DuplicateItem[]
      ): DuplicateGroup => {
        const files = groupFiles(items);
        const { totalStorageBytes, potentialSavingsBytes, uniqueFileCount, mirrorFlags } =
          computeGroupStorage(files);

        // Copy version lists while attaching mirror flags: versionsByItem
        // arrays are shared across groups, so flags must never mutate them.
        // groupFiles flattened in item order, one entry per version (or one
        // fallback entry for version-less items), so the flags line up.
        let fileIndex = 0;
        const flaggedItems = items.map((item) => {
          if (item.versions.length === 0) {
            fileIndex += 1;
            return item;
          }
          const versions = item.versions.map((version) => {
            const isMirror = mirrorFlags[fileIndex] === true;
            fileIndex += 1;
            return isMirror ? { ...version, isMirror: true } : { ...version };
          });
          return { ...item, versions };
        });

        const servers = new Set(items.map((item) => item.serverId));
        return {
          matchKey,
          matchType,
          confidence,
          serverCount: servers.size,
          sameServer: servers.size === 1,
          items: flaggedItems,
          uniqueFileCount,
          totalStorageBytes,
          potentialSavingsBytes,
        };
      };

      // Build duplicate groups from ID matches
      const duplicateGroups: DuplicateGroup[] = [];
      const multiItemGroupIds = new Set<string>();

      for (const match of idMatches) {
        const items = match.item_ids
          .map((id) => itemDetailsMap.get(id))
          .filter((details): details is ItemDetailsRow => details !== undefined)
          .map(toDuplicateItem);

        if (items.length >= 2) {
          for (const item of items) multiItemGroupIds.add(item.id);
          duplicateGroups.push(
            buildGroup(match.match_key, match.match_type, match.confidence, items)
          );
        }
      }

      // Add fuzzy matches as duplicate groups
      // Group fuzzy matches by combining item pairs into groups
      const fuzzyGroupsMap = new Map<string, Set<string>>();
      for (const fuzzy of fuzzyMatches) {
        if (fuzzy.confidence >= minConfidence) {
          const groupKey = `fuzzy:${fuzzy.title_a.toLowerCase().substring(0, 50)}`;
          if (!fuzzyGroupsMap.has(groupKey)) {
            fuzzyGroupsMap.set(groupKey, new Set());
          }
          const group = fuzzyGroupsMap.get(groupKey);
          if (group) {
            group.add(fuzzy.item_a_id);
            group.add(fuzzy.item_b_id);
          }
        }
      }

      for (const [groupKey, itemIdSet] of fuzzyGroupsMap) {
        let confidence = 70; // Default fuzzy confidence
        for (const fuzzy of fuzzyMatches) {
          if (itemIdSet.has(fuzzy.item_a_id) && itemIdSet.has(fuzzy.item_b_id)) {
            confidence = Math.max(confidence, fuzzy.confidence);
          }
        }

        const items = Array.from(itemIdSet)
          .map((id) => itemDetailsMap.get(id))
          .filter((details): details is ItemDetailsRow => details !== undefined)
          .map(toDuplicateItem);

        if (items.length >= 2) {
          for (const item of items) multiItemGroupIds.add(item.id);
          duplicateGroups.push(buildGroup(groupKey, 'fuzzy', confidence, items));
        }
      }

      // Version groups run LAST, after both ID and fuzzy groups have claimed
      // their items: an item shown inside any multi-item group already lists
      // its versions there, and a second group would double-report the same
      // reclaimable bytes in the summary
      for (const row of versionGroupRows) {
        if (multiItemGroupIds.has(row.id)) continue;
        const details = itemDetailsMap.get(row.id);
        if (!details) continue;
        const item = toDuplicateItem(details);
        if (item.versions.length < 2) continue;
        const group = buildGroup(`version:${row.id}`, 'version', 100, [item]);
        // Byte-identical listings under one item are the same physical file
        // (a renamed folder, a stale directory entry); nothing reclaimable
        if ((group.uniqueFileCount ?? 0) < 2) continue;
        duplicateGroups.push(group);
      }

      // Sort by confidence descending
      duplicateGroups.sort((a, b) => b.confidence - a.confidence);

      // Calculate pagination
      const total = duplicateGroups.length;
      const offset = (page - 1) * pageSize;
      const paginatedGroups = duplicateGroups.slice(offset, offset + pageSize);

      // Calculate summary
      const summary: DuplicatesSummary = {
        totalGroups: total,
        totalDuplicateItems: duplicateGroups.reduce((sum, g) => sum + g.items.length, 0),
        totalPotentialSavingsBytes: duplicateGroups.reduce(
          (sum, g) => sum + g.potentialSavingsBytes,
          0
        ),
        byMatchType: {
          imdb: duplicateGroups.filter((g) => g.matchType === 'imdb').length,
          tmdb: duplicateGroups.filter((g) => g.matchType === 'tmdb').length,
          tvdb: duplicateGroups.filter((g) => g.matchType === 'tvdb').length,
          fuzzy: duplicateGroups.filter((g) => g.matchType === 'fuzzy').length,
          version: duplicateGroups.filter((g) => g.matchType === 'version').length,
        },
      };

      const response: DuplicatesResponse = {
        duplicates: paginatedGroups,
        summary,
        pagination: { page, pageSize, total },
      };

      // Cache for 1 hour (duplicates change slowly)
      await app.redis.setex(cacheKey, CACHE_TTL.LIBRARY_DUPLICATES, JSON.stringify(response));

      return response;
    }
  );
};
