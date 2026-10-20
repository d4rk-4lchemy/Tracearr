/**
 * Play Statistics Routes
 *
 * GET /plays - Plays over time (engagement-based, >= 2 min sessions).
 *   Accepts an optional mediaType filter (movie|episode|live); omitting it keeps
 *   the response identical to before the filter existed.
 * GET /plays-by-dayofweek - Plays grouped by day of week
 * GET /plays-by-hourofday - Plays grouped by hour of day
 *
 * All three take groupBy=mediaType, which adds music and returns one series
 * per media group (movie, show, music), each row tagged with mediaType.
 *
 * All endpoints use engagement-based counting which filters out
 * sessions shorter than 2 minutes (Netflix-style "intent" threshold).
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { playsBreakdownQuerySchema, playsQuerySchema } from '@tracearr/shared';
import { resolveDateRange } from './utils.js';
import { resolveServerIds } from '../../utils/serverFiltering.js';
import { scopedServerFragment, viewScope } from '../../lib/scope.js';
import { queryPlaysOverTime, queryPlaysByDayOfWeek, queryPlaysByHourOfDay } from './queries.js';

/**
 * Get bucket interval based on the requested period.
 * Returns interval string for TimescaleDB time_bucket().
 */
export function getBucketInterval(period: string): string {
  switch (period) {
    case 'day':
      return '1 hour';
    case 'week':
      return '6 hours';
    case 'month':
    case 'year':
      return '1 day';
    case 'all':
    default:
      return '1 week';
  }
}

export const playsRoutes: FastifyPluginAsync = async (app) => {
  const readStats = { preHandler: [app.requirePermission('stats', 'read')] };
  /**
   * GET /plays - Plays over time (engagement-based)
   *
   * Returns validated plays (sessions >= 2 min) grouped by day.
   * Uses timezone-aware day bucketing so plays are grouped by user's local day.
   */
  app.get('/plays', readStats, async (request, reply) => {
    const query = playsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { period, startDate, endDate, serverId, serverIds, timezone, mediaType, groupBy } =
      query.data;
    const authUser = request.user;
    const dateRange = resolveDateRange(period, startDate, endDate);
    // Default to UTC for backwards compatibility
    const tz = timezone ?? 'UTC';

    const resolvedIds = resolveServerIds(authUser, serverId, serverIds);
    const serverFilter = scopedServerFragment(resolvedIds, request.scope);
    const bucketInterval = getBucketInterval(period);
    const customEnd = period === 'custom' && dateRange.end ? dateRange.end : undefined;
    const mediaTypeFilter = mediaType ? sql`AND media_type = ${mediaType}` : undefined;

    const data = await queryPlaysOverTime({
      rangeStart: dateRange.start,
      timezone: tz,
      bucketInterval,
      serverFilter,
      endDate: customEnd,
      mediaTypeFilter,
      groupByMediaType: groupBy === 'mediaType',
    });

    return { data };
  });

  /**
   * GET /plays-by-dayofweek - Plays grouped by day of week (engagement-based)
   *
   * Returns validated plays (sessions >= 2 min) grouped by day of week.
   */
  app.get('/plays-by-dayofweek', readStats, async (request, reply) => {
    const query = playsBreakdownQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { period, startDate, endDate, serverId, serverIds, timezone, groupBy } = query.data;
    const authUser = request.user;
    const dateRange = resolveDateRange(period, startDate, endDate);
    // Default to UTC for backwards compatibility
    const tz = timezone ?? 'UTC';

    const resolvedIds = resolveServerIds(authUser, serverId, serverIds);
    const serverFilter = scopedServerFragment(resolvedIds, await viewScope(request));
    const customEnd = period === 'custom' ? dateRange.end : undefined;

    const data = await queryPlaysByDayOfWeek({
      rangeStart: dateRange.start,
      timezone: tz,
      serverFilter,
      endDate: customEnd,
      groupByMediaType: groupBy === 'mediaType',
    });

    return { data };
  });

  /**
   * GET /plays-by-hourofday - Plays grouped by hour of day (engagement-based)
   *
   * Returns validated plays (sessions >= 2 min) grouped by hour of day.
   * Queries sessions table directly with duration filter since engagement
   * view only has daily granularity.
   */
  app.get('/plays-by-hourofday', readStats, async (request, reply) => {
    const query = playsBreakdownQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { period, startDate, endDate, serverId, serverIds, timezone, groupBy } = query.data;
    const authUser = request.user;
    const dateRange = resolveDateRange(period, startDate, endDate);
    // Default to UTC for backwards compatibility
    const tz = timezone ?? 'UTC';

    const resolvedIds = resolveServerIds(authUser, serverId, serverIds);
    const serverFilter = scopedServerFragment(resolvedIds, await viewScope(request));
    const customEnd = period === 'custom' ? dateRange.end : undefined;

    const data = await queryPlaysByHourOfDay({
      rangeStart: dateRange.start,
      timezone: tz,
      serverFilter,
      endDate: customEnd,
      groupByMediaType: groupBy === 'mediaType',
    });

    return { data };
  });
};
