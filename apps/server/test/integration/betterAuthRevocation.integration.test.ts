/**
 * Better Auth revocation-is-immediate integration test
 *
 * Guards the fix for the cookie-cache authorization window: cookieCache
 * (lib/auth.ts, 5m TTL) hands the client a signed session_data blob that
 * Better Auth would otherwise trust without hitting the session store. On the
 * protected-route resolver (sessionResolver.ts) we force disableCookieCache,
 * so revoking a session (CLI reset, mobile revoke, admin ban) stops passing
 * auth immediately instead of lingering for up to the cache TTL.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { API_BASE_PATH } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { authSessions } from '../../src/db/schema.js';
import { closeAuth } from '../../src/lib/auth.js';
import { createBetterAuthHandler } from '../../src/lib/betterAuthRequest.js';
import { getRedis } from '../../src/lib/redisShared.js';
import { resolveBetterAuthUser } from '../../src/lib/sessionResolver.js';

function baKey(key: string): string {
  const prefix = process.env.REDIS_PREFIX ?? '';
  return `${prefix}tracearr:ba:${key}`;
}

/** Rebuilds a Cookie header from a set-cookie response array (name=value only). */
function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    handler: createBetterAuthHandler(),
  });

  // Protected route guarded by the real authorization-path resolver.
  app.get('/protected', async (request, reply) => {
    const user = await resolveBetterAuthUser(request);
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    return { userId: user.userId };
  });

  return app;
}

describe('better auth revocation is immediate on protected routes (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    const redis = getRedis();
    const baKeys = await redis.keys(`${process.env.REDIS_PREFIX ?? ''}tracearr:ba:*`);
    if (baKeys.length > 0) {
      await redis.del(...baKeys);
    }
    await closeAuth();
  });

  it('rejects a held cookie immediately after the session is revoked, ignoring the cookie cache', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: `${API_BASE_PATH}/auth/sign-up/email`,
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'revoke-owner@example.com',
        password: 'RevokeOwner!12345',
        name: 'Revoke Owner',
        username: 'revokeowner',
      },
    });
    expect(signUp.statusCode).toBe(200);
    const userId = signUp.json().user.id as string;

    const setCookie = signUp.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
    const cookie = cookieHeader(cookies as string[]);
    // The test only proves something if the signed cookie-cache blob is present:
    // that is exactly what would keep a dead session alive without the fix.
    expect(cookie).toContain('session_data');

    const beforeRevoke = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie },
    });
    expect(beforeRevoke.statusCode).toBe(200);
    expect(beforeRevoke.json().userId).toBe(userId);

    // Revoke every session for the user the same way the CLI/admin/mobile
    // paths do: clear the Redis secondary-storage entries, then the DB rows.
    const rows = await db
      .select({ token: authSessions.token })
      .from(authSessions)
      .where(eq(authSessions.userId, userId));
    const redis = getRedis();
    await redis.del(baKey(`active-sessions-${userId}`), ...rows.map((r) => baKey(r.token)));
    await db.delete(authSessions).where(eq(authSessions.userId, userId));

    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
