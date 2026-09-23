/**
 * User Locations Route
 *
 * GET /:id/locations - Get user's unique locations (aggregated from sessions)
 */

import type { FastifyPluginAsync } from 'fastify';
import { userIdParamSchema, identityScopeQuerySchema } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { queryUserLocations, resolveIdentityScopedServerUserIds } from './queries.js';

export const locationsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /:id/locations - Get user's unique locations (aggregated from sessions)
   *
   * scope=identity expands the result to every account under the same
   * person that the caller can access.
   */
  app.get('/:id/locations', { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = userIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid user ID');
    }

    const query = identityScopeQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { id } = params.data;
    const authUser = request.user;

    const scoped = await resolveIdentityScopedServerUserIds(db, authUser, id, query.data.scope);
    if ('error' in scoped) {
      if (scoped.error === 'notFound') {
        return reply.notFound('User not found');
      }
      return reply.forbidden('You do not have access to this user');
    }

    const locations = await queryUserLocations(db, scoped.ids);

    return { data: locations };
  });
};
