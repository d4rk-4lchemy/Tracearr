/**
 * Library ROI route tests
 *
 * db.execute is mocked, so these prove which window reaches the SQL and the cache key, not the
 * SQL itself; libraryRoi.integration.test.ts covers the query.
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
import { libraryRoiRoute } from '../roi.js';
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
  await app.register(libraryRoiRoute, { prefix: '/library' });
  return app;
}

const firstQueryParams = () =>
  renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as never).params.filter(
    (param) => param instanceof Date
  );

describe('GET /library/roi', () => {
  let app: FastifyInstance;
  let redis: ReturnType<typeof createSpyRedis>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T15:00:00.000Z'));
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockImplementation((async (query: never) =>
      renderSql(query).sql.includes('LIMIT')
        ? { rows: [] }
        : {
            rows: [
              {
                summary_items: '0',
                summary_storage_gb: '0',
                summary_watch_hours: '0',
                summary_hours_per_gb: '0',
              },
            ],
          }) as never);
    redis = createSpyRedis();
    app = await buildTestApp(redis);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('passes a custom window to the SQL and the cache key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/library/roi?period=7d&startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(firstQueryParams()).toEqual([
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-15T00:00:00.000Z'),
    ]);
    expect(String(redis.setex.mock.calls[0]?.[0])).toContain(
      'custom:2026-09-01T00:00:00.000Z:2026-09-15T00:00:00.000Z'
    );
  });

  it('uses the 30d preset by default', async () => {
    const response = await app.inject({ method: 'GET', url: '/library/roi' });

    expect(response.statusCode).toBe(200);
    expect(firstQueryParams()).toEqual([
      new Date('2026-09-23T00:00:00.000Z'),
      new Date('2026-10-22T15:00:00.000Z'),
    ]);
    expect(String(redis.setex.mock.calls[0]?.[0])).toContain('-all-30d-watch_hours_per_gb-desc-');
  });

  it('ignores a stale periodDays param from an old client', async () => {
    const response = await app.inject({ method: 'GET', url: '/library/roi?periodDays=180' });

    expect(response.statusCode).toBe(200);
    expect(firstQueryParams()[0]).toEqual(new Date('2026-09-23T00:00:00.000Z'));
  });

  it('400s on a start without an end', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/library/roi?startDate=2026-09-01T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(400);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
