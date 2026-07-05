/**
 * Jellyfin login removal
 *
 * POST /jellyfin/login was cold-removed. Unmatched paths under /api/v1/auth
 * fall through to the Better Auth wildcard (mocked here, real handler
 * covered by betterAuthMount.test.ts), which answers with its own 404.
 * /jellyfin/connect-api-key is a legacy static route and must keep winning
 * over the wildcard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { API_BASE_PATH } from '@tracearr/shared';
import { createTestApp } from '../../test/helpers.js';

vi.mock('../../lib/auth.js', () => ({
  getAuth: vi.fn(),
  closeAuth: vi.fn(),
}));

import { getAuth } from '../../lib/auth.js';
import { authRoutes } from '../auth/index.js';

// Mirrors the mount added at index.ts (immediately before the authRoutes
// registration), scoped down to a minimal app so tests run without DB/Redis.
async function buildTestApp(): Promise<FastifyInstance> {
  const app = await createTestApp();
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });

  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    config: { rateLimit: false },
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await getAuth().handler(req);
      reply.status(response.status);
      for (const [key, value] of response.headers) {
        reply.header(key, value);
      }
      return await reply.send(response.body ? await response.text() : null);
    },
  });

  await app.register(authRoutes, { prefix: `${API_BASE_PATH}/auth` });
  return app;
}

describe('jellyfin login removal', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReset();
    vi.mocked(getAuth).mockReturnValue({
      handler: vi.fn(async () => new Response(null, { status: 404 })),
    } as unknown as ReturnType<typeof getAuth>);
  });

  it('the login endpoint is gone', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/jellyfin/login',
      payload: { username: 'x', password: 'y' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('connect-api-key still exists', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/jellyfin/connect-api-key',
      payload: {},
    });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });
});
