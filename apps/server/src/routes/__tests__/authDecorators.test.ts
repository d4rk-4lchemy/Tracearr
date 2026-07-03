/**
 * Auth Decorators Dual-Verify Tests
 *
 * Verifies `authenticate` and `requireOwner` resolve a Better Auth session
 * (cookie or bearer) first, falling back to legacy JWT verification.
 *
 * No live Postgres/Redis is available in this environment (see
 * betterAuthMount.test.ts for the same constraint on this branch), so
 * `getAuth()` is mocked rather than exercising a real Better Auth session
 * through the drizzle adapter. The decorators and `resolveBetterAuthUser`
 * under test are real; only the Better Auth session lookup and the server
 * IDs cache's DB query are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';

vi.mock('../../lib/auth.js', () => ({
  getAuth: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { getAuth } from '../../lib/auth.js';
import { db } from '../../db/client.js';
import authPlugin from '../../plugins/auth.js';

function mockBetterAuthSession(user: Record<string, unknown> | null) {
  const getSession = vi.fn().mockResolvedValue(user ? { user } : null);
  vi.mocked(getAuth).mockReturnValue({
    api: { getSession },
  } as unknown as ReturnType<typeof getAuth>);
  return getSession;
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);
  await app.register(cookie, { secret: 'test-cookie-secret' });
  await app.register(authPlugin);

  app.get('/test/protected', { preHandler: [app.authenticate] }, async (request) => {
    return request.user;
  });

  app.get('/test/owner-only', { preHandler: [app.requireOwner] }, async (request) => {
    return request.user;
  });

  return app;
}

describe('auth decorators with better auth sessions', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockResolvedValue([{ id: 'server-1' }, { id: 'server-2' }]),
    } as never);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.mocked(getAuth).mockReset();
  });

  it('authenticate accepts a better auth session cookie', async () => {
    mockBetterAuthSession({ id: 'user-1', username: 'owner', name: 'Owner', role: 'owner' });
    app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test/protected',
      headers: { cookie: 'better-auth.session_token=abc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('owner');
    expect(Array.isArray(res.json().serverIds)).toBe(true);
  });

  it('authenticate still accepts a legacy JWT', async () => {
    mockBetterAuthSession(null);
    app = await buildTestApp();

    const legacyToken = app.jwt.sign(
      { userId: 'user-1', username: 'owner', role: 'owner', serverIds: [] },
      { expiresIn: '1h' }
    );
    const res = await app.inject({
      method: 'GET',
      url: '/test/protected',
      headers: { authorization: `Bearer ${legacyToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('owner');
  });

  it('rejects requests with neither credential', async () => {
    mockBetterAuthSession(null);
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/test/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('requireOwner rejects a better auth session for a non-owner', async () => {
    mockBetterAuthSession({ id: 'user-2', username: 'viewer', name: 'Viewer', role: 'viewer' });
    app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/test/owner-only',
      headers: { cookie: 'better-auth.session_token=abc' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('requireOwner rejects requests with neither credential', async () => {
    mockBetterAuthSession(null);
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/test/owner-only' });
    expect(res.statusCode).toBe(401);
  });

  it('resolveBetterAuthUser lookup errors fail closed to the legacy JWT path', async () => {
    const getSession = vi.fn().mockRejectedValue(new Error('redis down'));
    vi.mocked(getAuth).mockReturnValue({ api: { getSession } } as unknown as ReturnType<
      typeof getAuth
    >);
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/test/protected' });
    expect(res.statusCode).toBe(401);
  });
});
