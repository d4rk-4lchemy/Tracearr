/**
 * Library top content route tests
 *
 * db.execute is mocked, so these prove which window reaches the SQL and the cache key, not the
 * SQL itself.
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
import { libraryTopContentRoute } from '../topContent.js';
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
  await app.register(libraryTopContentRoute, { prefix: '/library' });
  return app;
}

const executed = () => vi.mocked(db.execute).mock.calls.map((call) => renderSql(call[0] as never));

describe('GET /library/top-movies and /library/top-shows', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockImplementation((async (query: never) => {
      const text = renderSql(query).sql;
      return text.includes('AS total_movies') || text.includes('AS total_shows')
        ? { rows: [{ total_movies: '0', total_shows: '0', total_watch_hours: '0' }] }
        : { rows: [] };
    }) as never);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('bounds both lists by the custom startDate/endDate instead of the period token', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(redis);
    const range = 'startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z';

    for (const path of ['top-movies', 'top-shows']) {
      vi.mocked(db.execute).mockClear();
      const response = await app.inject({
        method: 'GET',
        url: `/library/${path}?period=7d&${range}`,
      });
      expect(response.statusCode).toBe(200);
      const queries = executed();
      expect(queries.some((q) => q.sql.includes('AS earliest'))).toBe(false);
      expect(queries[0]?.params).toEqual(
        expect.arrayContaining([
          new Date('2026-09-01T00:00:00.000Z'),
          new Date('2026-09-15T00:00:00.000Z'),
        ])
      );
    }
    expect(redis.setex.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('custom:2026-09-01T00:00:00.000Z:2026-09-15T00:00:00.000Z'),
      expect.stringContaining('custom:2026-09-01T00:00:00.000Z:2026-09-15T00:00:00.000Z'),
    ]);
  });

  it('keeps the period token when no dates are given', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(redis);

    const response = await app.inject({ method: 'GET', url: '/library/top-movies?period=all' });

    expect(response.statusCode).toBe(200);
    expect(executed()[0]?.sql).toContain(
      'MIN(day)::date AS earliest FROM daily_content_engagement'
    );
    expect(String(redis.setex.mock.calls[0]?.[0])).toContain(':all-plays-desc-1-20');
  });
});
