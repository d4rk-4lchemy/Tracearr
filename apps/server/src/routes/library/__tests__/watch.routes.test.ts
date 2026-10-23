/**
 * Library watch route tests
 *
 * db.execute is mocked, so these prove which window reaches the SQL and the cache key, not the
 * SQL itself; libraryWatch.integration.test.ts covers the query.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@tracearr/shared';
import { renderSql } from '../../../test/helpers.js';

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../../../db/client.js';
import { libraryWatchRoute } from '../watch.js';
import { permissionGuard } from '../../../lib/scope.js';

function createSpyRedis() {
  return {
    get: vi.fn(async (_key: string) => null),
    setex: vi.fn(async (_key: string, _seconds: number, _value: string) => 'OK'),
  };
}

async function buildTestApp(redis: ReturnType<typeof createSpyRedis>): Promise<FastifyInstance> {
  const owner: AuthUser = { userId: randomUUID(), username: 'owner', role: 'owner', serverIds: [] };
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = owner;
  });
  app.decorate('requirePermission', permissionGuard(app));
  app.decorate('redis', redis as never);
  await app.register(libraryWatchRoute, { prefix: '/library' });
  return app;
}

const firstQueryDates = () =>
  renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as never).params.filter(
    (param) => param instanceof Date
  );

describe('GET /library/watch', () => {
  let app: FastifyInstance;
  let redis: ReturnType<typeof createSpyRedis>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T15:00:00.000Z'));
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
    redis = createSpyRedis();
    app = await buildTestApp(redis);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('passes the window to the SQL and the cache key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/library/watch?startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(firstQueryDates()).toEqual([
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-15T00:00:00.000Z'),
    ]);
    expect(String(redis.setex.mock.calls[0]?.[0])).toContain(
      'custom:2026-09-01T00:00:00.000Z:2026-09-15T00:00:00.000Z'
    );
  });

  it('defaults to 30d', async () => {
    const response = await app.inject({ method: 'GET', url: '/library/watch' });

    expect(response.statusCode).toBe(200);
    expect(firstQueryDates()).toEqual([
      new Date('2026-09-23T00:00:00.000Z'),
      new Date('2026-10-22T15:00:00.000Z'),
    ]);
    expect(String(redis.setex.mock.calls[0]?.[0])).toMatch(/-30d$/);
    expect(response.json().summary).toMatchObject({ totalItems: 0, watchedPct: 0 });
  });
});
