/**
 * Better Auth catch-all mount tests
 *
 * Verifies the wildcard route registered in index.ts (GET/POST
 * /api/v1/auth/*) forwards unmatched requests to the Better Auth handler
 * while the legacy static routes registered under the same prefix keep
 * winning for their exact paths. The route handler under test is the REAL
 * production one (createBetterAuthHandler from lib/betterAuthRequest.ts).
 *
 * No live Postgres/Redis is available in this environment, so getAuth() is
 * mocked here rather than exercising the real Better Auth + drizzle adapter
 * (that flow is covered by the integration suite).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { API_BASE_PATH } from '@tracearr/shared';
import { createTestApp } from '../../test/helpers.js';

vi.mock('../../lib/auth.js', () => ({
  getAuth: vi.fn(),
  closeAuth: vi.fn(),
  // toWebRequest stamps this header on every forwarded request; the mock
  // must carry the real wire value or headers.set(undefined, ...) throws.
  CLIENT_IP_HEADER: 'x-tracearr-client-ip',
}));

import { getAuth } from '../../lib/auth.js';
import { createBetterAuthHandler } from '../../lib/betterAuthRequest.js';
import { authRoutes } from '../auth/index.js';

// Mirrors the mount in index.ts (immediately before the authRoutes
// registration), scoped down to a minimal app so tests run without DB/Redis.
// Built on the repo's createTestApp() helper since authRoutes' sub-plugins
// (plex/jellyfin/emby) reference the app.authenticate decorator.
async function buildApp(): Promise<FastifyInstance> {
  const app = await createTestApp();
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });

  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    config: { rateLimit: false },
    handler: createBetterAuthHandler(),
  });

  await app.register(authRoutes, { prefix: `${API_BASE_PATH}/auth` });
  return app;
}

describe('better auth mount', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReset();
  });

  it('forwards unmatched paths under /api/v1/auth to the better auth handler', async () => {
    const handler = vi.fn(
      async (_req: Request) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'better-auth.session=abc; Path=/',
          },
        })
    );
    vi.mocked(getAuth).mockReturnValue({ handler } as unknown as ReturnType<typeof getAuth>);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up/email',
      payload: { email: 'owner@example.com', password: 'password1234' },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [forwardedRequest] = handler.mock.calls[0]!;
    expect(forwardedRequest.method).toBe('POST');
    expect(forwardedRequest.url).toContain('/api/v1/auth/sign-up/email');
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });

  it('still serves the legacy static routes over the wildcard', async () => {
    const handler = vi.fn();
    vi.mocked(getAuth).mockReturnValue({ handler } as unknown as ReturnType<typeof getAuth>);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/validate-claim-code',
      payload: { claimCode: 'x' },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).not.toBe(404);

    await app.close();
  });

  it('returns 500 when the better auth handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    vi.mocked(getAuth).mockReturnValue({ handler } as unknown as ReturnType<typeof getAuth>);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/get-session',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal authentication error' });

    await app.close();
  });
});
