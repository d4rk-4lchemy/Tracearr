/**
 * Session Management Routes
 *
 * GET /me - Get current user info
 */

import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { getAllServerIds } from './utils.js';
import { getUserById } from '../../services/userService.js';
import { db } from '../../db/client.js';
import { authAccounts } from '../../db/schema.js';
import { loadScope } from '../../lib/scope.js';

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /me - Get current user info
   */
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const authUser = request.user;

    const user = await getUserById(authUser.userId);

    if (!user) {
      // User in JWT doesn't exist in database - token is invalid
      throw app.httpErrors.unauthorized('User no longer exists');
    }

    const scope = await loadScope(user.id, user.role);
    const serverIds = scope === 'all' ? await getAllServerIds() : scope.serverIds;

    const [credential] = await db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential')))
      .limit(1);
    const [plexLink] = await db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'plex')))
      .limit(1);

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      thumbnail: user.thumbnail,
      role: user.role,
      // A member never sees the trust score the owner keeps on them.
      ...(scope === 'all' ? { aggregateTrustScore: user.aggregateTrustScore } : {}),
      serverIds,
      hasPassword: !!user.passwordHash || !!credential,
      hasPlexLinked: !!user.plexAccountId || !!plexLink,
      impersonatedBy: authUser.impersonatedBy,
    };
  });
};
