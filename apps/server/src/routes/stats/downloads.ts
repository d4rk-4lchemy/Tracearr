/**
 * Downloads Route
 *
 * GET /downloads - Download cards and a page of rows over a range, staff only
 */

import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { downloadsListQuerySchema, isStaff } from '@tracearr/shared';
import { resolveDateRange } from './utils.js';
import { resolveServerIds } from '../../utils/serverFiltering.js';
import { scopedServerFragment } from '../../lib/scope.js';
import { queryDownloadsStats } from '../../services/downloads/queries.js';

export const downloadsRoutes: FastifyPluginAsync = async (app) => {
  const readStats = { preHandler: [app.requirePermission('stats', 'read')] };

  app.get('/downloads', readStats, async (request, reply) => {
    if (!isStaff(request.user.role)) {
      return reply.forbidden('Downloads are only visible to staff');
    }
    const query = downloadsListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { period, startDate, endDate, serverId, serverIds, page, pageSize } = query.data;
    const dateRange = resolveDateRange(period, startDate, endDate);
    const resolvedIds = resolveServerIds(request.user, serverId, serverIds);

    const where = sql`true
      ${dateRange.start ? sql`AND media_downloads.first_seen_at >= ${dateRange.start}` : sql``}
      ${period === 'custom' ? sql`AND media_downloads.first_seen_at < ${dateRange.end}` : sql``}
      ${scopedServerFragment(
        resolvedIds,
        request.scope,
        'media_downloads.server_id',
        sql`media_downloads.server_user_id`
      )}`;

    return queryDownloadsStats(where, page, pageSize);
  });
};
