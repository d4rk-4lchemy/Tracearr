/**
 * Violation management routes
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  count,
  desc,
  gte,
  lt,
  lte,
  isNull,
  isNotNull,
  sql,
  inArray,
  type SQL,
} from 'drizzle-orm';
import {
  violationBulkBodySchema,
  violationIdParamSchema,
  violationQuerySchema,
  violationRosterFilterSchema,
  type AuthUser,
  type ListResponse,
  type ViolationBulkBody,
  type ViolationRosterFilters,
  type ViolationSessionInfo,
  type ViolationSortField,
  type ViolationWithDetails,
} from '@tracearr/shared';
import { db } from '../db/client.js';
import {
  violations,
  rules,
  serverUsers,
  sessions,
  servers,
  users,
  ruleActionResults,
} from '../db/schema.js';
import {
  hasServerAccess,
  resolveServerIds,
  buildMultiServerCondition,
} from '../utils/serverFiltering.js';
import { getServerUserDisplayNames, recomputeIdentityAggregates } from '../services/userService.js';
import { resolveAccessibleServerUserIdsForIdentities } from './users/queries.js';
import {
  buildOrderBy,
  utcDayEnd,
  utcDayStart,
  type SortDirection,
  type SortKey,
} from '../utils/listQuery.js';

/**
 * Merge the legacy singular `userId` identity filter with the new `userIds`
 * multi-select form into one deduplicated list. Both can be sent together
 * (e.g. a stale client alongside a new one), so this is additive, not either/or.
 */
function collectIdentityUserIds(userId: string | undefined, userIds: string[] | undefined) {
  return Array.from(new Set([...(userIds ?? []), ...(userId ? [userId] : [])]));
}

/**
 * Sort keys, every branch tiebroken on violations.id by buildOrderBy. Without a
 * unique tiebreak, offset paging over rows sharing a created_at (a poller tick
 * writes several at once) both repeats and drops rows between pages.
 *
 * The severity CASE ranks high above low so DESC means high-first, which is
 * what the column header's descending state has always shown.
 */
const VIOLATION_SORT_KEYS: Record<ViolationSortField, SortKey> = {
  createdAt: { key: sql`${violations.createdAt}`, defaultDir: 'desc' },
  severity: {
    key: sql`CASE ${violations.severity} WHEN 'high' THEN 3 WHEN 'warning' THEN 2 WHEN 'low' THEN 1 END`,
    defaultDir: 'desc',
  },
  user: { key: sql`${serverUsers.username}`, defaultDir: 'desc' },
  rule: { key: sql`${rules.name}`, defaultDir: 'desc' },
};

interface ViolationRosterConditions {
  /** Nothing can match, so callers skip the query and answer with an empty set. */
  empty: boolean;
  conditions: SQL[];
}

/**
 * The single definition of "which violations are in this roster".
 *
 * GET /, its count, POST /bulk/acknowledge and DELETE /bulk all build their row
 * set from this. They used to build it four separate ways, and the two bulk
 * copies accepted a narrower filter set: filtering the table by a rule or a
 * date range and hitting "select all" acted on rows the table never showed, and
 * DELETE /bulk reverses trust as it dismisses. Sharing the builder makes that
 * drift a type error rather than silent data loss.
 *
 * Async because the identity filter has to resolve accessible server-user ids
 * before it can become a predicate.
 */
export async function buildViolationRosterConditions(
  filters: ViolationRosterFilters,
  authUser: AuthUser
): Promise<ViolationRosterConditions> {
  const resolvedIds = resolveServerIds(authUser, filters.serverId, filters.serverIds, {
    strict: false,
  });
  if (resolvedIds?.length === 0) {
    return { empty: true, conditions: [] };
  }

  const conditions: SQL[] = [];

  const serverCondition = buildMultiServerCondition(resolvedIds, serverUsers.serverId);
  if (serverCondition) {
    conditions.push(serverCondition);
  }

  if (filters.serverUserId) {
    conditions.push(eq(violations.serverUserId, filters.serverUserId));
  }

  // An identity with no accessible account contributes nothing, and a set that
  // resolves to nothing is an empty result rather than a 403, matching the
  // non-strict server scoping above.
  const identityUserIds = collectIdentityUserIds(filters.userId, filters.userIds);
  if (identityUserIds.length > 0) {
    const identityServerUserIds = await resolveAccessibleServerUserIdsForIdentities(
      db,
      authUser,
      identityUserIds
    );
    if (identityServerUserIds.length === 0) {
      return { empty: true, conditions: [] };
    }
    conditions.push(inArray(violations.serverUserId, identityServerUserIds));
  }

  if (filters.ruleId) {
    conditions.push(eq(violations.ruleId, filters.ruleId));
  }

  if (filters.severity) {
    conditions.push(eq(violations.severity, filters.severity));
  }

  if (filters.acknowledged === true) {
    conditions.push(isNotNull(violations.acknowledgedAt));
  } else if (filters.acknowledged === false) {
    conditions.push(isNull(violations.acknowledgedAt));
  }

  conditions.push(isNull(violations.dismissedAt));

  const startDate = utcDayStart(filters.startDate);
  if (startDate) {
    conditions.push(gte(violations.createdAt, startDate));
  }
  const endDate = utcDayEnd(filters.endDate);
  if (endDate) {
    conditions.push(lt(violations.createdAt, endDate));
  }

  return { empty: false, conditions };
}

/**
 * The id set a bulk action operates on: the explicit ids, or every violation the
 * roster filters match. Both bulk endpoints go through here so neither can
 * resolve selectAll differently from the other.
 */
async function resolveBulkViolationIds(
  body: ViolationBulkBody,
  authUser: AuthUser
): Promise<string[]> {
  if (!body.selectAll) {
    return body.ids ?? [];
  }

  const roster = await buildViolationRosterConditions(
    body.filters ?? violationRosterFilterSchema.parse({}),
    authUser
  );
  if (roster.empty) {
    return [];
  }

  const matching = await db
    .select({ id: violations.id })
    .from(violations)
    .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
    .where(and(...roster.conditions));

  return matching.map((row) => row.id);
}

/**
 * The flat shape returned by the violation select queries (with joins).
 * Used as input to enrichViolations().
 */
interface ViolationRow {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string | null;
  serverUserId: string;
  username: string;
  userThumb: string | null;
  identityName: string | null;
  identityUserId: string;
  serverId: string;
  serverName: string;
  sessionId: string | null;
  mediaTitle: string | null;
  mediaType: string | null;
  grandparentTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  year: number | null;
  ipAddress: string | null;
  geoCity: string | null;
  geoRegion: string | null;
  geoCountry: string | null;
  geoContinent: string | null;
  geoPostal: string | null;
  geoLat: number | null;
  geoLon: number | null;
  playerName: string | null;
  device: string | null;
  deviceId: string | null;
  platform: string | null;
  product: string | null;
  quality: string | null;
  startedAt: Date | null;
  severity: 'low' | 'warning' | 'high';
  data: Record<string, unknown> | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

/**
 * Enrich flat violation rows with related sessions, user history, and action results.
 * Works for both single-item and multi-item arrays.
 */
async function enrichViolations(violationData: ViolationRow[]) {
  if (violationData.length === 0) return [];

  // Identify violations that need historical/related data to batch queries
  const violationsNeedingData = violationData.filter((v) => {
    // V1 violations (old records): check ruleType
    if (
      v.ruleType &&
      ['concurrent_streams', 'simultaneous_locations', 'device_velocity'].includes(v.ruleType)
    ) {
      return true;
    }
    // V2 violations: check for relatedSessionIds in data
    const data = v.data;
    return (
      Array.isArray(data?.relatedSessionIds) && (data.relatedSessionIds as string[]).length > 0
    );
  });

  // Collect all relatedSessionIds from violation data for direct lookup
  const allRelatedSessionIds = new Set<string>();
  for (const v of violationsNeedingData) {
    const relatedIds = (v.data?.relatedSessionIds as string[] | undefined) ?? [];
    for (const id of relatedIds) {
      allRelatedSessionIds.add(id);
    }
  }

  // Batch fetch historical data by serverUserId to avoid N+1 queries
  const historicalDataByUserId = new Map<
    string,
    Array<{
      ipAddress: string;
      deviceId: string | null;
      device: string | null;
      geoCity: string | null;
      geoCountry: string | null;
      startedAt: Date;
    }>
  >();

  // Batch fetch related sessions by (serverUserId, ruleType) to avoid N+1 queries
  const relatedSessionsByViolation = new Map<string, ViolationSessionInfo[]>();

  // Map to store fetched sessions by ID for direct lookup from relatedSessionIds
  const sessionsById = new Map<string, ViolationSessionInfo>();

  // Wrap batching in try-catch to handle errors gracefully (e.g., in tests or when queries fail)
  try {
    if (violationsNeedingData.length > 0) {
      // Group violations by serverUserId and find the oldest violation time for each user
      const userViolationTimes = new Map<string, Date>();
      for (const v of violationsNeedingData) {
        const existing = userViolationTimes.get(v.serverUserId);
        if (!existing || v.createdAt < existing) {
          userViolationTimes.set(v.serverUserId, v.createdAt);
        }
      }

      // Batch fetch historical sessions for each unique serverUserId
      // Go back 30 days from the oldest violation time for each user
      const historicalPromises = Array.from(userViolationTimes.entries()).map(
        async ([serverUserId, oldestViolationTime]) => {
          try {
            const historyWindow = new Date(
              oldestViolationTime.getTime() - 30 * 24 * 60 * 60 * 1000
            );
            const historicalSessions = await db
              .select({
                ipAddress: sessions.ipAddress,
                deviceId: sessions.deviceId,
                device: sessions.device,
                geoCity: sessions.geoCity,
                geoCountry: sessions.geoCountry,
                startedAt: sessions.startedAt,
              })
              .from(sessions)
              .where(
                and(
                  eq(sessions.serverUserId, serverUserId),
                  gte(sessions.startedAt, historyWindow),
                  lte(sessions.startedAt, oldestViolationTime)
                )
              )
              .limit(1000); // Get enough to build a good history

            return [serverUserId, historicalSessions] as const;
          } catch (error) {
            // If query fails (e.g., in tests), return empty array for this user
            console.error(
              `[Violations] Failed to fetch historical data for user ${serverUserId}:`,
              error
            );
            const emptyArray: Array<{
              ipAddress: string;
              deviceId: string | null;
              device: string | null;
              geoCity: string | null;
              geoCountry: string | null;
              startedAt: Date;
            }> = [];
            return [serverUserId, emptyArray] as const;
          }
        }
      );

      const historicalResults = await Promise.allSettled(historicalPromises);
      for (const result of historicalResults) {
        if (result.status === 'fulfilled') {
          const [serverUserId, sessions] = result.value;
          historicalDataByUserId.set(serverUserId, sessions);
        }
        // If rejected, that user just won't have historical data (already handled in catch)
      }
    }

    // Batch fetch sessions by ID from relatedSessionIds stored in violation data
    if (allRelatedSessionIds.size > 0) {
      try {
        const relatedSessionsResult = await db
          .select({
            id: sessions.id,
            mediaTitle: sessions.mediaTitle,
            mediaType: sessions.mediaType,
            grandparentTitle: sessions.grandparentTitle,
            seasonNumber: sessions.seasonNumber,
            episodeNumber: sessions.episodeNumber,
            year: sessions.year,
            ipAddress: sessions.ipAddress,
            geoCity: sessions.geoCity,
            geoRegion: sessions.geoRegion,
            geoCountry: sessions.geoCountry,
            geoContinent: sessions.geoContinent,
            geoPostal: sessions.geoPostal,
            geoLat: sessions.geoLat,
            geoLon: sessions.geoLon,
            playerName: sessions.playerName,
            device: sessions.device,
            deviceId: sessions.deviceId,
            platform: sessions.platform,
            product: sessions.product,
            quality: sessions.quality,
            startedAt: sessions.startedAt,
          })
          .from(sessions)
          .where(inArray(sessions.id, Array.from(allRelatedSessionIds)));

        for (const s of relatedSessionsResult) {
          sessionsById.set(s.id, {
            ...s,
            deviceId: s.deviceId ?? null,
          });
        }
      } catch (error) {
        console.error('[Violations] Failed to batch fetch related sessions by ID:', error);
        // Continue without related sessions - fallback to time-based logic
      }
    }

    if (violationsNeedingData.length > 0) {
      // Group violations by (serverUserId, ruleType) and find time ranges
      const violationGroups = new Map<
        string,
        {
          violations: Array<{ id: string; createdAt: Date }>;
          earliestTime: Date;
          latestTime: Date;
        }
      >();

      for (const v of violationsNeedingData) {
        const key = `${v.serverUserId}:${v.ruleType}`;
        const existing = violationGroups.get(key);
        const violationTime = v.createdAt;
        const timeWindow = new Date(violationTime.getTime() - 5 * 60 * 1000); // 5 minutes before violation

        if (existing) {
          existing.violations.push({ id: v.id, createdAt: violationTime });
          if (timeWindow < existing.earliestTime) {
            existing.earliestTime = timeWindow;
          }
          if (violationTime > existing.latestTime) {
            existing.latestTime = violationTime;
          }
        } else {
          violationGroups.set(key, {
            violations: [{ id: v.id, createdAt: violationTime }],
            earliestTime: timeWindow,
            latestTime: violationTime,
          });
        }
      }

      // Batch fetch related sessions for each group
      const relatedSessionsPromises = Array.from(violationGroups.entries()).map(
        async ([key, group]) => {
          const parts = key.split(':');
          const serverUserId = parts[0];
          const ruleType = parts[1];
          if (!serverUserId || !ruleType) {
            console.error(`[Violations] Invalid key format: ${key}`);
            // Mark all violations in this group as having no related sessions
            for (const violation of group.violations) {
              relatedSessionsByViolation.set(violation.id, []);
            }
            return;
          }
          const conditions = [
            eq(sessions.serverUserId, serverUserId),
            gte(sessions.startedAt, group.earliestTime),
            lte(sessions.startedAt, group.latestTime),
          ];

          // Add rule-type-specific conditions
          if (ruleType === 'concurrent_streams') {
            conditions.push(eq(sessions.state, 'playing'));
            conditions.push(isNull(sessions.stoppedAt));
          } else if (ruleType === 'simultaneous_locations') {
            conditions.push(eq(sessions.state, 'playing'));
            conditions.push(isNull(sessions.stoppedAt));
            conditions.push(isNotNull(sessions.geoLat));
            conditions.push(isNotNull(sessions.geoLon));
          }
          // device_velocity has no additional conditions

          try {
            const sessionsResult = await db
              .select({
                id: sessions.id,
                mediaTitle: sessions.mediaTitle,
                mediaType: sessions.mediaType,
                grandparentTitle: sessions.grandparentTitle,
                seasonNumber: sessions.seasonNumber,
                episodeNumber: sessions.episodeNumber,
                year: sessions.year,
                ipAddress: sessions.ipAddress,
                geoCity: sessions.geoCity,
                geoRegion: sessions.geoRegion,
                geoCountry: sessions.geoCountry,
                geoContinent: sessions.geoContinent,
                geoPostal: sessions.geoPostal,
                geoLat: sessions.geoLat,
                geoLon: sessions.geoLon,
                playerName: sessions.playerName,
                device: sessions.device,
                deviceId: sessions.deviceId,
                platform: sessions.platform,
                product: sessions.product,
                quality: sessions.quality,
                startedAt: sessions.startedAt,
              })
              .from(sessions)
              .where(and(...conditions))
              .orderBy(desc(sessions.startedAt))
              .limit(100); // Fetch more to cover all violations in the group

            const mappedSessions = sessionsResult.map((s) => ({
              ...s,
              deviceId: s.deviceId ?? null,
            }));

            // Filter sessions to each violation's specific 5-minute window
            for (const violation of group.violations) {
              const violationTime = violation.createdAt;
              const timeWindow = new Date(violationTime.getTime() - 5 * 60 * 1000);
              const violationSessions = mappedSessions
                .filter((s) => s.startedAt >= timeWindow && s.startedAt <= violationTime)
                .slice(0, 20); // Limit to 20 per violation
              relatedSessionsByViolation.set(violation.id, violationSessions);
            }
          } catch (error) {
            // If fetching fails, mark all violations in this group as having no related sessions
            console.error(`[Violations] Failed to fetch related sessions for group ${key}:`, error);
            for (const violation of group.violations) {
              relatedSessionsByViolation.set(violation.id, []);
            }
          }
        }
      );

      await Promise.allSettled(relatedSessionsPromises);
      // Errors are already handled in individual try-catch blocks
    }
  } catch (error) {
    // If batching fails (e.g., in tests or when queries fail), continue without extra data
    // This prevents the entire violation list from failing
    console.error('[Violations] Failed to batch fetch historical/related data:', error);
  }

  // Batch fetch action results for all violations
  const actionResultsByViolation = new Map<
    string,
    Array<{
      actionType: string;
      success: boolean;
      skipped: boolean | null;
      skipReason: string | null;
      errorMessage: string | null;
      executedAt: Date;
    }>
  >();

  try {
    const violationIds = violationData.map((v) => v.id);
    if (violationIds.length > 0) {
      const actionResults = await db
        .select({
          violationId: ruleActionResults.violationId,
          actionType: ruleActionResults.actionType,
          success: ruleActionResults.success,
          skipped: ruleActionResults.skipped,
          skipReason: ruleActionResults.skipReason,
          errorMessage: ruleActionResults.errorMessage,
          executedAt: ruleActionResults.executedAt,
        })
        .from(ruleActionResults)
        .where(inArray(ruleActionResults.violationId, violationIds));

      // Group by violation ID
      for (const result of actionResults) {
        if (!result.violationId) continue;
        const existing = actionResultsByViolation.get(result.violationId) ?? [];
        existing.push({
          actionType: result.actionType,
          success: result.success,
          skipped: result.skipped,
          skipReason: result.skipReason,
          errorMessage: result.errorMessage,
          executedAt: result.executedAt,
        });
        actionResultsByViolation.set(result.violationId, existing);
      }
    }
  } catch (error) {
    console.error('[Violations] Failed to batch fetch action results:', error);
  }

  // Transform flat data into nested structure expected by frontend
  return violationData.map((v) => {
    // Fetch related sessions - prioritize using relatedSessionIds from violation data
    // This is more accurate than time-based queries
    const relatedSessionIdsFromData = (v.data?.relatedSessionIds as string[] | undefined) ?? [];

    let relatedSessions: ViolationSessionInfo[];
    if (relatedSessionIdsFromData.length > 0) {
      // Use the stored relatedSessionIds for direct lookup (preferred)
      relatedSessions = relatedSessionIdsFromData
        .map((id) => sessionsById.get(id))
        .filter((s): s is ViolationSessionInfo => s !== undefined);
    } else {
      // Fallback to time-based query results for older violations
      relatedSessions = relatedSessionsByViolation.get(v.id) ?? [];
    }

    // For concurrent_streams, simultaneous_locations, and device_velocity, fetch related sessions
    // Also fetch user's historical data for comparison
    let userHistory: {
      previousIPs: string[];
      previousDevices: string[];
      previousLocations: Array<{ city: string | null; country: string | null; ip: string }>;
    } = {
      previousIPs: [],
      previousDevices: [],
      previousLocations: [],
    };

    if (
      v.ruleType &&
      ['concurrent_streams', 'simultaneous_locations', 'device_velocity'].includes(v.ruleType)
    ) {
      const violationTime = v.createdAt;

      // Use batched historical data, filtered to this violation's time window
      const allHistoricalSessions = historicalDataByUserId.get(v.serverUserId) ?? [];
      const historicalSessions = allHistoricalSessions.filter(
        (s) =>
          s.startedAt >= new Date(violationTime.getTime() - 30 * 24 * 60 * 60 * 1000) &&
          s.startedAt <= violationTime
      );

      // Build unique sets of previous values
      const ipSet = new Set<string>();
      const deviceSet = new Set<string>();
      const locationMap = new Map<
        string,
        { city: string | null; country: string | null; ip: string }
      >();

      for (const hist of historicalSessions) {
        if (hist.ipAddress) ipSet.add(hist.ipAddress);
        if (hist.deviceId) deviceSet.add(hist.deviceId);
        if (hist.device) deviceSet.add(hist.device);
        if (hist.geoCity || hist.geoCountry) {
          const locKey = `${hist.geoCity ?? ''}-${hist.geoCountry ?? ''}`;
          if (!locationMap.has(locKey)) {
            locationMap.set(locKey, {
              city: hist.geoCity,
              country: hist.geoCountry,
              ip: hist.ipAddress,
            });
          }
        }
      }

      userHistory = {
        previousIPs: Array.from(ipSet),
        previousDevices: Array.from(deviceSet),
        previousLocations: Array.from(locationMap.values()),
      };
    }

    return {
      id: v.id,
      ruleId: v.ruleId,
      serverUserId: v.serverUserId,
      sessionId: v.sessionId,
      severity: v.severity,
      data: v.data,
      createdAt: v.createdAt,
      acknowledgedAt: v.acknowledgedAt,
      rule: {
        id: v.ruleId,
        name: v.ruleName,
        type: v.ruleType,
      },
      user: {
        id: v.serverUserId,
        username: v.username,
        thumbUrl: v.userThumb,
        serverId: v.serverId,
        identityName: v.identityName,
        userId: v.identityUserId,
      },
      server: {
        id: v.serverId,
        name: v.serverName,
      },
      session: {
        id: v.sessionId,
        mediaTitle: v.mediaTitle,
        mediaType: v.mediaType,
        grandparentTitle: v.grandparentTitle,
        seasonNumber: v.seasonNumber,
        episodeNumber: v.episodeNumber,
        year: v.year,
        ipAddress: v.ipAddress,
        geoCity: v.geoCity,
        geoRegion: v.geoRegion,
        geoCountry: v.geoCountry,
        geoContinent: v.geoContinent,
        geoPostal: v.geoPostal,
        geoLat: v.geoLat,
        geoLon: v.geoLon,
        playerName: v.playerName,
        device: v.device,
        deviceId: v.deviceId ?? null,
        platform: v.platform,
        product: v.product,
        quality: v.quality,
        startedAt: v.startedAt,
      },
      relatedSessions: relatedSessions.length > 0 ? relatedSessions : undefined,
      userHistory:
        Object.keys(userHistory.previousIPs).length > 0 ||
        Object.keys(userHistory.previousDevices).length > 0 ||
        userHistory.previousLocations.length > 0
          ? userHistory
          : undefined,
      actionResults: (() => {
        const results = actionResultsByViolation.get(v.id);
        if (!results || results.length === 0) return undefined;
        return results.map((r) => ({
          actionType: r.actionType,
          success: r.success,
          skipped: r.skipped ?? false,
          skipReason: r.skipReason ?? undefined,
          errorMessage: r.errorMessage ?? undefined,
          executedAt: r.executedAt.toISOString(),
        }));
      })(),
      evidence: v.data?.evidence as ViolationWithDetails['evidence'] | undefined,
    };
  });
}

/**
 * The page query. `where` comes from buildViolationRosterConditions, and the
 * count query below reuses it unchanged.
 */
function buildViolationPageQuery(params: {
  where: SQL | undefined;
  orderBy: ViolationSortField;
  orderDir: SortDirection | undefined;
  pageSize: number;
  offset: number;
}) {
  const { where, orderBy, orderDir, pageSize, offset } = params;

  return db
    .select({
      id: violations.id,
      ruleId: violations.ruleId,
      ruleName: rules.name,
      ruleType: rules.type,
      serverUserId: violations.serverUserId,
      username: serverUsers.username,
      userThumb: serverUsers.thumbUrl,
      identityName: users.name,
      identityUserId: serverUsers.userId,
      serverId: serverUsers.serverId,
      serverName: servers.name,
      sessionId: violations.sessionId,
      // Session details for context
      mediaTitle: sessions.mediaTitle,
      mediaType: sessions.mediaType,
      grandparentTitle: sessions.grandparentTitle,
      seasonNumber: sessions.seasonNumber,
      episodeNumber: sessions.episodeNumber,
      year: sessions.year,
      ipAddress: sessions.ipAddress,
      geoCity: sessions.geoCity,
      geoRegion: sessions.geoRegion,
      geoCountry: sessions.geoCountry,
      geoContinent: sessions.geoContinent,
      geoPostal: sessions.geoPostal,
      geoLat: sessions.geoLat,
      geoLon: sessions.geoLon,
      playerName: sessions.playerName,
      device: sessions.device,
      deviceId: sessions.deviceId,
      platform: sessions.platform,
      product: sessions.product,
      quality: sessions.quality,
      startedAt: sessions.startedAt,
      severity: violations.severity,
      data: violations.data,
      createdAt: violations.createdAt,
      acknowledgedAt: violations.acknowledgedAt,
    })
    .from(violations)
    .innerJoin(rules, eq(violations.ruleId, rules.id))
    .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
    .leftJoin(users, eq(serverUsers.userId, users.id))
    .innerJoin(servers, eq(serverUsers.serverId, servers.id))
    .leftJoin(sessions, eq(violations.sessionId, sessions.id))
    .where(where)
    .orderBy(buildOrderBy(VIOLATION_SORT_KEYS, orderBy, orderDir, sql`${violations.id}`))
    .limit(pageSize)
    .offset(offset);
}

/** The list row shape, derived so the envelope cannot drift from the mapper. */
type EnrichedViolation = Awaited<ReturnType<typeof enrichViolations>>[number];

export const violationRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /violations - List violations with pagination and filters
   *
   * Violations are filtered by server access. Users only see violations
   * from servers they have access to.
   */
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = violationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { page, pageSize, orderBy, orderDir, ...filters } = query.data;
    const authUser = request.user;
    const offset = (page - 1) * pageSize;

    const roster = await buildViolationRosterConditions(filters, authUser);
    if (roster.empty) {
      return { data: [], meta: { page, pageSize, total: 0 } } satisfies ListResponse<never>;
    }

    const where = and(...roster.conditions);

    const violationData = await buildViolationPageQuery({
      where,
      orderBy,
      orderDir,
      pageSize,
      offset,
    });

    // Counted off the same conditions, minus the joins only the select list
    // needs. A hand-written copy of these predicates is what let the count
    // disagree with the page it was counting.
    const countRows = await db
      .select({ total: count() })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(where);
    const total = countRows[0]?.total ?? 0;

    const formattedData = await enrichViolations(violationData);

    return {
      data: formattedData,
      meta: { page, pageSize, total },
    } satisfies ListResponse<EnrichedViolation>;
  });

  /**
   * GET /violations/:id - Get a specific violation with full details
   */
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = violationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid violation ID');
    }

    const { id } = params.data;
    const authUser = request.user;

    // Query with server info for access check, including all session fields
    const violationRows = await db
      .select({
        id: violations.id,
        ruleId: violations.ruleId,
        ruleName: rules.name,
        ruleType: rules.type,
        serverUserId: violations.serverUserId,
        username: serverUsers.username,
        userThumb: serverUsers.thumbUrl,
        identityName: users.name,
        identityUserId: serverUsers.userId,
        serverId: serverUsers.serverId,
        serverName: servers.name,
        sessionId: violations.sessionId,
        mediaTitle: sessions.mediaTitle,
        mediaType: sessions.mediaType,
        grandparentTitle: sessions.grandparentTitle,
        seasonNumber: sessions.seasonNumber,
        episodeNumber: sessions.episodeNumber,
        year: sessions.year,
        ipAddress: sessions.ipAddress,
        geoCity: sessions.geoCity,
        geoRegion: sessions.geoRegion,
        geoCountry: sessions.geoCountry,
        geoContinent: sessions.geoContinent,
        geoPostal: sessions.geoPostal,
        geoLat: sessions.geoLat,
        geoLon: sessions.geoLon,
        playerName: sessions.playerName,
        device: sessions.device,
        deviceId: sessions.deviceId,
        platform: sessions.platform,
        product: sessions.product,
        quality: sessions.quality,
        startedAt: sessions.startedAt,
        severity: violations.severity,
        data: violations.data,
        createdAt: violations.createdAt,
        acknowledgedAt: violations.acknowledgedAt,
      })
      .from(violations)
      .innerJoin(rules, eq(violations.ruleId, rules.id))
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .leftJoin(users, eq(serverUsers.userId, users.id))
      .innerJoin(servers, eq(serverUsers.serverId, servers.id))
      .leftJoin(sessions, eq(violations.sessionId, sessions.id))
      .where(and(eq(violations.id, id), isNull(violations.dismissedAt)))
      .limit(1);

    const violation = violationRows[0];
    if (!violation) {
      return reply.notFound('Violation not found');
    }

    // Check server access
    if (!hasServerAccess(authUser, violation.serverId)) {
      return reply.forbidden('You do not have access to this violation');
    }

    // Enrich with related sessions, user history, and action results
    const enriched = await enrichViolations([violation]);
    const enrichedViolation = enriched[0];
    if (!enrichedViolation) {
      return reply.notFound('Violation not found');
    }

    // Resolve display names for user_id array conditions (in/not_in) in evidence
    if (enrichedViolation.evidence && enrichedViolation.evidence.length > 0) {
      const userIdSet = new Set<string>();
      for (const group of enrichedViolation.evidence) {
        for (const cond of group.conditions) {
          // only threshold holds uuids; cond.actual is a display name, not an id
          if (cond.field === 'user_id' && Array.isArray(cond.threshold)) {
            for (const id of cond.threshold) {
              if (typeof id === 'string') userIdSet.add(id);
            }
          }
        }
      }
      if (userIdSet.size > 0) {
        try {
          const userNames = await getServerUserDisplayNames([...userIdSet]);
          return { ...enrichedViolation, userNames };
        } catch (err) {
          request.log.error(
            { err, violationId: id },
            'failed to resolve user display names for violation detail'
          );
        }
      }
    }

    return enrichedViolation;
  });

  /**
   * PATCH /violations/:id - Acknowledge a violation
   */
  app.patch('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = violationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid violation ID');
    }

    const { id } = params.data;
    const authUser = request.user;

    // Only owners can acknowledge violations
    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can acknowledge violations');
    }

    // Check violation exists and get server info for access check
    const violationRows = await db
      .select({
        id: violations.id,
        serverId: serverUsers.serverId,
      })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(and(eq(violations.id, id), isNull(violations.dismissedAt)))
      .limit(1);

    const violation = violationRows[0];
    if (!violation) {
      return reply.notFound('Violation not found');
    }

    // Check server access
    if (!hasServerAccess(authUser, violation.serverId)) {
      return reply.forbidden('You do not have access to this violation');
    }

    // Update acknowledgment
    const updated = await db
      .update(violations)
      .set({
        acknowledgedAt: new Date(),
      })
      .where(and(eq(violations.id, id), isNull(violations.dismissedAt)))
      .returning({
        id: violations.id,
        acknowledgedAt: violations.acknowledgedAt,
      });

    const updatedViolation = updated[0];
    if (!updatedViolation) {
      return reply.internalServerError('Failed to acknowledge violation');
    }

    return {
      success: true,
      acknowledgedAt: updatedViolation.acknowledgedAt,
    };
  });

  /**
   * DELETE /violations/:id - Dismiss a violation
   *
   * Dismissing a violation:
   * 1. Reverses any trust score changes made by explicit rule actions (adjust_trust)
   * 2. Soft-deletes the row (dismissedAt) so dedup keeps blocking re-creation
   *
   * This treats dismiss as "false positive, undo everything".
   * For just marking as seen, use PATCH (acknowledge) instead.
   */
  app.delete('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = violationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid violation ID');
    }

    const { id } = params.data;
    const authUser = request.user;

    // Only owners can delete violations
    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can dismiss violations');
    }

    // Check violation exists and get info needed for trust reversal. A
    // dismissed violation 404s so trust can never be reversed twice.
    const violationRows = await db
      .select({
        id: violations.id,
        ruleId: violations.ruleId,
        serverUserId: violations.serverUserId,
        serverId: serverUsers.serverId,
        userId: serverUsers.userId,
      })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(and(eq(violations.id, id), isNull(violations.dismissedAt)))
      .limit(1);

    const violation = violationRows[0];
    if (!violation) {
      return reply.notFound('Violation not found');
    }

    // Check server access
    if (!hasServerAccess(authUser, violation.serverId)) {
      return reply.forbidden('You do not have access to this violation');
    }

    // Calculate trust adjustment to reverse from rule's actions
    let trustAdjustmentToReverse = 0;
    const ruleRows = await db
      .select({ actions: rules.actions })
      .from(rules)
      .where(eq(rules.id, violation.ruleId))
      .limit(1);

    const rule = ruleRows[0];
    const ruleActions = rule?.actions?.actions;
    if (ruleActions && Array.isArray(ruleActions)) {
      for (const action of ruleActions) {
        if (action.type === 'adjust_trust' && typeof action.amount === 'number') {
          // Sum up all trust adjustments made by this rule
          trustAdjustmentToReverse += Number(action.amount);
        }
      }
    }

    // Dismiss violation and reverse trust score atomically. Soft delete: the
    // row stays so session and inactivity dedup keep blocking re-creation.
    // The dismissedAt guard on the write makes a concurrent dismiss lose the
    // race cleanly instead of reversing trust twice.
    const dismissed = await db.transaction(async (tx) => {
      const stamped = await tx
        .update(violations)
        .set({ dismissedAt: new Date() })
        .where(and(eq(violations.id, id), isNull(violations.dismissedAt)))
        .returning({ id: violations.id });

      if (stamped.length === 0) {
        return false;
      }

      // Reverse trust score adjustment (if any was made)
      if (trustAdjustmentToReverse !== 0) {
        // Reverse by applying the opposite adjustment
        await tx
          .update(serverUsers)
          .set({
            trustScore: sql`LEAST(100, GREATEST(0, ${serverUsers.trustScore} - ${trustAdjustmentToReverse}))`,
            updatedAt: new Date(),
          })
          .where(eq(serverUsers.id, violation.serverUserId));
      }

      // users.totalViolations counts non-dismissed rows, so the rollup must
      // recompute on every dismiss, not only when trust was reversed.
      await recomputeIdentityAggregates(violation.userId, tx);
      return true;
    });

    if (!dismissed) {
      return reply.notFound('Violation not found');
    }

    return { success: true };
  });

  /**
   * POST /violations/bulk/acknowledge - Bulk acknowledge violations
   * Accepts either specific IDs or filter params with selectAll flag
   */
  app.post('/bulk/acknowledge', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    // Only owners can acknowledge violations
    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can acknowledge violations');
    }

    const parsedBody = violationBulkBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.badRequest('Invalid request body');
    }
    const body = parsedBody.data;

    if (!body.ids && !body.selectAll) {
      return reply.badRequest('Either ids or selectAll must be provided');
    }

    const violationIds = await resolveBulkViolationIds(body, authUser);

    if (violationIds.length === 0) {
      return { success: true, acknowledged: 0 };
    }

    // Verify access to all violations. Filtering dismissed rows here keeps
    // them out of accessibleIds so the acknowledged count stays honest.
    const accessibleViolations = await db
      .select({
        id: violations.id,
        serverId: serverUsers.serverId,
      })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(and(inArray(violations.id, violationIds), isNull(violations.dismissedAt)));

    // Filter to only accessible violations
    const accessibleIds = accessibleViolations
      .filter((v) => hasServerAccess(authUser, v.serverId))
      .map((v) => v.id);

    if (accessibleIds.length === 0) {
      return { success: true, acknowledged: 0 };
    }

    // Bulk update
    await db
      .update(violations)
      .set({ acknowledgedAt: new Date() })
      .where(and(inArray(violations.id, accessibleIds), isNull(violations.dismissedAt)));

    return { success: true, acknowledged: accessibleIds.length };
  });

  /**
   * DELETE /violations/bulk - Bulk dismiss (delete) violations
   * Accepts either specific IDs or filter params with selectAll flag
   */
  app.delete('/bulk', { preHandler: [app.authenticate] }, async (request, reply) => {
    const authUser = request.user;

    // Only owners can dismiss violations
    if (authUser.role !== 'owner') {
      return reply.forbidden('Only server owners can dismiss violations');
    }

    const parsedBody = violationBulkBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.badRequest('Invalid request body');
    }
    const body = parsedBody.data;

    if (!body.ids && !body.selectAll) {
      return reply.badRequest('Either ids or selectAll must be provided');
    }

    const violationIds = await resolveBulkViolationIds(body, authUser);

    if (violationIds.length === 0) {
      return { success: true, dismissed: 0 };
    }

    // Get violation details including rule ID for trust reversal. Dismissed
    // rows are excluded so re-sending their ids cannot re-reverse trust.
    const violationDetails = await db
      .select({
        id: violations.id,
        ruleId: violations.ruleId,
        serverUserId: violations.serverUserId,
        serverId: serverUsers.serverId,
        userId: serverUsers.userId,
      })
      .from(violations)
      .innerJoin(serverUsers, eq(violations.serverUserId, serverUsers.id))
      .where(and(inArray(violations.id, violationIds), isNull(violations.dismissedAt)));

    // Filter to only accessible violations
    const accessibleViolations = violationDetails.filter((v) =>
      hasServerAccess(authUser, v.serverId)
    );

    if (accessibleViolations.length === 0) {
      return { success: true, dismissed: 0 };
    }

    // Get unique rule IDs to fetch their actions
    const uniqueRuleIds = [...new Set(accessibleViolations.map((v) => v.ruleId))];
    const ruleRows = await db
      .select({ id: rules.id, actions: rules.actions })
      .from(rules)
      .where(inArray(rules.id, uniqueRuleIds));

    // Build map of ruleId -> trust adjustment amount
    const ruleAdjustments = new Map<string, number>();
    for (const rule of ruleRows) {
      let adjustment = 0;
      const ruleActions = rule.actions?.actions;
      if (ruleActions && Array.isArray(ruleActions)) {
        for (const action of ruleActions) {
          if (action.type === 'adjust_trust' && typeof action.amount === 'number') {
            adjustment += Number(action.amount);
          }
        }
      }
      ruleAdjustments.set(rule.id, adjustment);
    }

    const accessibleIds = accessibleViolations.map((v) => v.id);

    // Dismiss violations and reverse trust scores atomically. Soft delete:
    // the rows stay so session and inactivity dedup keep blocking re-creation.
    // Reversals derive from the rows THIS request stamped, so a concurrent
    // dismiss racing the same ids cannot reverse trust twice.
    const dismissedCount = await db.transaction(async (tx) => {
      const stamped = await tx
        .update(violations)
        .set({ dismissedAt: new Date() })
        .where(and(inArray(violations.id, accessibleIds), isNull(violations.dismissedAt)))
        .returning({ id: violations.id });
      const stampedIds = new Set(stamped.map((row) => row.id));
      const stampedViolations = accessibleViolations.filter((v) => stampedIds.has(v.id));

      // Reverse trust scores for each affected user
      const trustReverseByUser = new Map<string, number>();
      for (const v of stampedViolations) {
        const adjustment = ruleAdjustments.get(v.ruleId) ?? 0;
        if (adjustment !== 0) {
          trustReverseByUser.set(
            v.serverUserId,
            (trustReverseByUser.get(v.serverUserId) ?? 0) + adjustment
          );
        }
      }
      for (const [serverUserId, totalAdjustment] of trustReverseByUser) {
        // Reverse by applying the opposite adjustment
        await tx
          .update(serverUsers)
          .set({
            trustScore: sql`LEAST(100, GREATEST(0, ${serverUsers.trustScore} - ${totalAdjustment}))`,
            updatedAt: new Date(),
          })
          .where(eq(serverUsers.id, serverUserId));
      }

      // users.totalViolations counts non-dismissed rows, so every affected
      // identity recomputes, not only the trust-reversed ones. Once per
      // identity, since a merged person can have several accounts here.
      const affectedIdentityIds = new Set(stampedViolations.map((v) => v.userId));
      for (const identityId of affectedIdentityIds) {
        await recomputeIdentityAggregates(identityId, tx);
      }

      return stamped.length;
    });

    return { success: true, dismissed: dismissedCount };
  });
};
