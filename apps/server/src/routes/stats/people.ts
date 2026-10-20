/**
 * People Route
 *
 * GET /people - Every person on the resolved servers ranked by one metric over a range,
 * with a summary of the whole population
 */

import type { FastifyPluginAsync } from 'fastify';
import { peopleQuerySchema } from '@tracearr/shared';
import { resolveServerIds } from '../../utils/serverFiltering.js';
import { queryPeopleRanked, resolvePeopleWindow } from '../../services/stats/peopleStats.js';

export const peopleRoutes: FastifyPluginAsync = async (app) => {
  const readUsers = { preHandler: [app.requirePermission('users', 'read')] };

  app.get('/people', readUsers, async (request, reply) => {
    const query = peopleQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { serverId, serverIds, rank, page, pageSize, search } = query.data;
    return queryPeopleRanked({
      authUser: request.user,
      resolvedServerIds: resolveServerIds(request.user, serverId, serverIds),
      window: resolvePeopleWindow(query.data),
      rank,
      page,
      pageSize,
      search,
    });
  });
};
