/**
 * Genres route tests
 *
 * db.execute is mocked (this suite's convention, see catalog.routes.test.ts),
 * so these prove handler mechanics, response shape, and the cache contract -
 * not SQL correctness. Real-DB query correctness (merge bucketing, scoping,
 * type filtering, the artist roll-up) lives in
 * apps/server/test/integration/genres.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import { REDIS_KEYS, type AuthUser, type GenresResponse } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { renderSql } from '../../../test/helpers.js';

const { scopeRedis } = vi.hoisted(() => ({ scopeRedis: { get: vi.fn(), set: vi.fn() } }));

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));
vi.mock('../../../lib/redisShared.js', () => ({ getRedis: () => scopeRedis }));
vi.mock('../../../services/settings.js', () => ({ getSetting: vi.fn().mockResolvedValue(false) }));

import { db } from '../../../db/client.js';
import { libraryGenresRoute } from '../genres.js';
import { permissionGuard } from '../../../lib/scope.js';

const SERVER = '33333333-3333-4333-8333-333333333333';
const OWN = '11111111-1111-4111-8111-111111111111';

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function createSpyRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  };
}

async function buildTestApp(
  authUser: AuthUser,
  redis: ReturnType<typeof createSpyRedis>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));
  app.decorate('redis', redis as never);
  await app.register(libraryGenresRoute, { prefix: '/library' });
  return app;
}

function createOwnerUser(): AuthUser {
  return { userId: randomUUID(), username: 'owner', role: 'owner', serverIds: [] };
}

function createViewerUser(serverIds: string[]): AuthUser {
  return { userId: randomUUID(), username: 'viewer', role: 'admin', serverIds };
}

const MEMBER: AuthUser = { userId: 'u-member', username: 'mia', role: 'member', serverIds: [] };

function executed(): { text: string; params: unknown[] }[] {
  return vi.mocked(db.execute).mock.calls.map((call) => {
    const rendered = renderSql(call[0] as SQL);
    return { text: normalize(rendered.sql), params: rendered.params };
  });
}

// Answers each statement by what it reads, so the order of the parallel queries never matters.
function answer(rows: { items?: unknown[]; plays?: unknown[] } = {}) {
  vi.mocked(db.execute).mockImplementation((async (query: SQL) => {
    const text = renderSql(query).sql;
    if (text.includes('AS list')) return { rows: [] };
    if (text.includes('total_items')) return { rows: rows.items ?? [] };
    if (text.includes('total_plays')) return { rows: rows.plays ?? [] };
    return { rows: [] };
  }) as never);
}

describe('GET /library/genres', () => {
  let app: FastifyInstance;
  const dbExecute = vi.mocked(db.execute);

  beforeEach(() => {
    dbExecute.mockReset();
    answer();
    scopeRedis.get.mockResolvedValue(
      JSON.stringify({
        serverUserIds: [OWN],
        serverIds: [SERVER],
        libraryIds: { [SERVER]: ['lib-1'] },
      })
    );
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('defaults to movies over the last month', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);

    const response = await app.inject({ method: 'GET', url: '/library/genres' });

    expect(response.statusCode).toBe(200);
    const items = executed().find((q) => q.text.includes('total_items'));
    expect(items?.params).toContain('movie');
    const [key] = redis.setex.mock.calls.map((call) => String(call[0]));
    expect(key).toMatch(new RegExp(`^${REDIS_KEYS.LIBRARY_GENRES}:all:movie:UTC:month:`));
  });

  it('rejects an invalid type value', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    const response = await app.inject({ method: 'GET', url: '/library/genres?type=song' });
    expect(response.statusCode).toBe(400);
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('rejects a custom period without dates', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    const response = await app.inject({ method: 'GET', url: '/library/genres?period=custom' });
    expect(response.statusCode).toBe(400);
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('accepts a single-day custom range as that one UTC day', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    const response = await app.inject({
      method: 'GET',
      url: '/library/genres?period=custom&startDate=2026-09-15T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z',
    });
    expect(response.statusCode).toBe(200);
    const [key] = redis.setex.mock.calls.map((call) => String(call[0]));
    expect(key).toContain(':custom:2026-09-15T00:00:00.000Z:2026-09-16T00:00:00.000Z');
  });

  it('accepts type=artist and reads artist genres from the canonical artist media row', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);

    const response = await app.inject({ method: 'GET', url: '/library/genres?type=artist' });

    expect(response.statusCode).toBe(200);
    const plays = executed().find((q) => q.text.includes('total_plays'));
    expect(plays?.text).toContain('JOIN media pmr ON pmr.id = ar.media_id');
    expect(plays?.text).toContain('unnest(canon.genres)');
  });

  it('shapes a populated response merging items and plays per genre', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    answer({
      items: [
        {
          total_items: 4,
          genre: 'Action',
          item_count: 3,
          size_bytes: '3000',
          never_played_count: 1,
          never_played_bytes: '1000',
        },
        {
          total_items: 4,
          genre: 'Drama',
          item_count: 1,
          size_bytes: '500',
          never_played_count: 1,
          never_played_bytes: '500',
        },
      ],
      plays: [
        {
          total_plays: 10,
          total_prior_plays: 6,
          genre: 'Action',
          plays: 10,
          prior_plays: 6,
          watched_ms: '600000',
          finished: 4,
          judged: 5,
          trend: [1, 1, 1, 1, 2, 2, 2],
          viewers: [
            {
              userId: 'u1',
              serverUserId: 'su1',
              name: 'Ana',
              thumbUrl: '/a.png',
              serverId: 's1',
              plays: 7,
            },
          ],
        },
      ],
    });

    const response = await app.inject({ method: 'GET', url: '/library/genres?type=movie' });

    expect(response.statusCode).toBe(200);
    const body: GenresResponse = response.json();
    expect(body.data).toEqual([
      {
        genre: 'Action',
        itemCount: 3,
        sizeBytes: 3000,
        plays: 10,
        priorPlays: 6,
        watchTimeMs: 600000,
        finishedRate: 80,
        topViewer: {
          userId: 'u1',
          serverUserId: 'su1',
          name: 'Ana',
          thumbUrl: '/a.png',
          serverId: 's1',
          share: 70,
        },
        neverPlayed: { count: 1, bytes: 1000 },
        trend: [1, 1, 1, 1, 2, 2, 2],
      },
      {
        genre: 'Drama',
        itemCount: 1,
        sizeBytes: 500,
        plays: 0,
        priorPlays: 0,
        watchTimeMs: 0,
        finishedRate: null,
        topViewer: null,
        neverPlayed: { count: 1, bytes: 500 },
        trend: [0, 0, 0, 0, 0, 0, 0],
      },
    ]);
    expect(body.totals).toEqual({ items: 4, plays: 10, priorPlays: 6 });
    expect(body.hourly).toHaveLength(24);
  });

  it('scopes a member: their libraries for items, their accounts for plays', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(MEMBER, redis);

    const response = await app.inject({ method: 'GET', url: '/library/genres?type=show' });

    expect(response.statusCode).toBe(200);
    const items = executed().find((q) => q.text.includes('total_items'));
    const plays = executed().find((q) => q.text.includes('total_plays'));
    expect(items?.text).toContain('li.library_id IN');
    expect(items?.params).toContain('lib-1');
    expect(plays?.text).toContain('p.server_user_id IN');
    expect(plays?.params).toContain(OWN);
  });

  it('keys the cache on period, aligned bounds, member and library segments', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(MEMBER, redis);

    await app.inject({
      method: 'GET',
      url: '/library/genres?type=movie&period=custom&startDate=2026-10-01T00:00:00.000Z&endDate=2026-10-07T12:00:00.000Z',
    });

    expect(redis.setex.mock.calls.map((call) => String(call[0]))).toEqual([
      `${REDIS_KEYS.LIBRARY_GENRES}:${SERVER}:movie:UTC:custom:2026-10-01T00:00:00.000Z:2026-10-08T00:00:00.000Z:member:u-member:libs:${SERVER}=lib-1`,
    ]);
  });

  it('caches the computed genres and skips recompute on a hit', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);

    const first = await app.inject({ method: 'GET', url: '/library/genres?type=movie' });
    expect(first.statusCode).toBe(200);
    expect(redis.setex).toHaveBeenCalledTimes(1);

    dbExecute.mockClear();
    const second = await app.inject({ method: 'GET', url: '/library/genres?type=movie' });
    expect(second.statusCode).toBe(200);
    expect(dbExecute).not.toHaveBeenCalled();
    expect(second.json()).toEqual(first.json());
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('uses a distinct cache entry per scope for the same type', async () => {
    const redis = createSpyRedis();

    const appA = await buildTestApp(createViewerUser([randomUUID()]), redis);
    await appA.inject({ method: 'GET', url: '/library/genres?type=movie' });
    await appA.close();

    const appB = await buildTestApp(createViewerUser([randomUUID()]), redis);
    await appB.inject({ method: 'GET', url: '/library/genres?type=movie' });
    await appB.close();

    expect(new Set(redis.setex.mock.calls.map((call) => call[0])).size).toBe(2);
  });
});

describe('GET /library/genres/:genre', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(db.execute).mockReset();
    answer();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('answers 404 for a genre with neither items of the type nor plays in the window', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    answer({ items: [{ total_items: 3, genre: null }] });

    const response = await app.inject({ method: 'GET', url: '/library/genres/Western?type=show' });

    expect(response.statusCode).toBe(404);
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('returns the sheet, cached under the genre', async () => {
    const redis = createSpyRedis();
    app = await buildTestApp(createOwnerUser(), redis);
    answer({
      items: [
        {
          total_items: 4,
          genre: 'Sci-Fi',
          item_count: 2,
          size_bytes: '10',
          never_played_count: 0,
          never_played_bytes: '0',
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/library/genres/${encodeURIComponent('Sci-Fi')}?type=movie&period=week`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      genre: 'Sci-Fi',
      kpis: { itemCount: 2, itemShare: 50 },
    });
    const [key] = redis.setex.mock.calls.map((call) => String(call[0]));
    expect(key).toMatch(/:week:.*:genre:Sci-Fi$/);
  });
});
