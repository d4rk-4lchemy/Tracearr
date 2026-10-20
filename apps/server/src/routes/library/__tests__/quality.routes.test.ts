/**
 * Library quality route tests
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
import { libraryQualityRoute } from '../quality.js';
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
  await app.register(libraryQualityRoute, { prefix: '/library' });
  return app;
}

function mainQueryParams(): unknown[] {
  const main = vi
    .mocked(db.execute)
    .mock.calls.map((call) => renderSql(call[0] as never))
    .find((query) => query.sql.includes('WITH date_series AS'));
  return main?.params ?? [];
}

describe('GET /library/quality', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('reads the custom startDate/endDate window instead of the period token', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(redis);

    const response = await app.inject({
      method: 'GET',
      url: '/library/quality?period=30d&startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    const params = mainQueryParams();
    expect(params).toEqual(
      expect.arrayContaining(['2026-09-01T00:00:00.000Z', '2026-09-14T23:59:59.999Z'])
    );
    expect(params).not.toContain('2026-09-15T00:00:00.000Z');
    expect(String(redis.setex.mock.calls[0]?.[0])).toContain(
      'custom:2026-09-01T00:00:00.000Z:2026-09-15T00:00:00.000Z'
    );
  });

  it('keeps the period token when no dates are given, and rejects one date alone', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(redis);

    const before = Date.now();
    const response = await app.inject({ method: 'GET', url: '/library/quality?period=7d' });
    expect(response.statusCode).toBe(200);
    const [start, end] = mainQueryParams();
    expect(Math.abs(new Date(String(start)).getTime() - (before - 7 * 86_400_000))).toBeLessThan(
      60_000
    );
    expect(Math.abs(new Date(String(end)).getTime() - before)).toBeLessThan(60_000);

    const lone = await app.inject({
      method: 'GET',
      url: '/library/quality?startDate=2026-09-01T00:00:00.000Z',
    });
    expect(lone.statusCode).toBe(400);
  });

  it('takes the singular media types and rejects the old plural ones', async () => {
    app = await buildTestApp(createSpyRedis());

    const plural = await app.inject({ method: 'GET', url: '/library/quality?mediaType=movies' });
    expect(plural.statusCode).toBe(400);

    const movie = await app.inject({ method: 'GET', url: '/library/quality?mediaType=movie' });
    expect(movie.statusCode).toBe(200);
    expect(movie.json().mediaType).toBe('movie');
    const main = vi
      .mocked(db.execute)
      .mock.calls.map((call) => renderSql(call[0] as never))
      .find((query) => query.sql.includes('WITH date_series AS'));
    expect(main?.sql).toContain('lsd.movie_count > 0 AND lsd.episode_count = 0');
  });
});
