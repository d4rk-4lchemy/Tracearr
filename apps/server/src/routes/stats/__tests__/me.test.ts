/**
 * Your stats route tests
 *
 * computeStreaks is pure and tested directly. GET /stats/me is tested with db.execute mocked, so
 * these prove whose accounts reach the SQL and the cache key; the SQL itself is checked against
 * TimescaleDB in test/integration/myStats.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { REDIS_KEYS, type AuthUser } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { queryChain, renderSql } from '../../../test/helpers.js';

const { scopeRedis } = vi.hoisted(() => ({ scopeRedis: { get: vi.fn(), set: vi.fn() } }));

vi.mock('../../../db/client.js', () => ({ db: { execute: vi.fn(), select: vi.fn() } }));
vi.mock('../../../lib/redisShared.js', () => ({ getRedis: () => scopeRedis }));
vi.mock('../../../services/settings.js', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

import { db } from '../../../db/client.js';
import { computeStreaks, meRoutes } from '../me.js';
import { permissionGuard } from '../../../lib/scope.js';

const OWN = '11111111-1111-4111-8111-111111111111';
const OWNER_ACCOUNT = '22222222-2222-4222-8222-222222222222';

describe('computeStreaks', () => {
  const now = new Date('2026-10-08T15:00:00Z');

  it('is all zeros with no days', () => {
    expect(computeStreaks([], now, 'UTC')).toEqual({
      daysWatched: 0,
      currentStreak: 0,
      longestStreak: 0,
    });
  });

  it('counts a single play today as a one-day streak', () => {
    expect(computeStreaks(['2026-10-08'], now, 'UTC')).toEqual({
      daysWatched: 1,
      currentStreak: 1,
      longestStreak: 1,
    });
  });

  it('breaks a run at a gap and keeps the longest', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-10-08'];
    expect(computeStreaks(days, now, 'UTC')).toEqual({
      daysWatched: 5,
      currentStreak: 1,
      longestStreak: 3,
    });
  });

  it('keeps a streak that ended yesterday current, and drops one that ended before', () => {
    expect(computeStreaks(['2026-10-06', '2026-10-07'], now, 'UTC').currentStreak).toBe(2);
    expect(computeStreaks(['2026-10-05', '2026-10-06'], now, 'UTC').currentStreak).toBe(0);
  });

  it("judges today in the viewer's timezone", () => {
    // 03:00 UTC on the 9th is still the evening of the 8th in New York.
    const lateEvening = new Date('2026-10-09T03:00:00Z');
    expect(computeStreaks(['2026-10-07'], lateEvening, 'America/New_York').currentStreak).toBe(1);
    expect(computeStreaks(['2026-10-07'], lateEvening, 'UTC').currentStreak).toBe(0);
  });
});

describe('GET /stats/me', () => {
  let app: FastifyInstance;
  const redis = { get: vi.fn(), setex: vi.fn() };

  async function build(user: AuthUser): Promise<void> {
    app = Fastify({ logger: false });
    await app.register(sensible);
    app.decorate('authenticate', async (request: { user: AuthUser }) => {
      request.user = user;
    });
    app.decorate('requirePermission', permissionGuard(app));
    app.decorate('redis', redis as never);
    await app.register(meRoutes, { prefix: '/stats' });
  }

  const sent = () =>
    vi.mocked(db.execute).mock.calls.map((call) => renderSql(call[0] as SQL).params);

  beforeEach(() => {
    vi.clearAllMocks();
    redis.get.mockResolvedValue(null);
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
  });

  afterEach(async () => {
    await app.close();
  });

  it("sends only the member's accounts and caches under the member segment", async () => {
    scopeRedis.get.mockResolvedValue(JSON.stringify({ serverUserIds: [OWN], serverIds: [] }));
    await build({ userId: 'u-member', username: 'mia', role: 'member', serverIds: [] });

    const response = await app.inject({ url: '/stats/me?timezone=America/New_York' });

    expect(response.statusCode).toBe(200);
    expect(sent()).toHaveLength(4);
    for (const params of sent()) expect(params).toContain(OWN);
    expect(sent()[0]).toContain('America/New_York');
    expect(redis.setex.mock.calls[0]?.[0]).toBe(
      `${REDIS_KEYS.MY_STATS}:member:u-member:America/New_York`
    );
  });

  it('sums every non-trailer session into watch time while only qualifying plays count as days', async () => {
    scopeRedis.get.mockResolvedValue(JSON.stringify({ serverUserIds: [OWN], serverIds: [] }));
    // The third day holds only a 90 s play: the history aggregates count its time, so all time must too
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [
        { day: '2026-10-07', counts: true, watched_ms: '3600000' },
        { day: '2026-10-08', counts: true, watched_ms: '5400000' },
        { day: '2026-10-09', counts: false, watched_ms: '90000' },
      ],
    } as never);
    await build({ userId: 'u-member', username: 'mia', role: 'member', serverIds: [] });

    const body = (await app.inject({ url: '/stats/me' })).json();

    expect(body.totalWatchTimeMs).toBe(9_090_000);
    expect(body.daysWatched).toBe(2);
    expect(renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as SQL).sql).toMatch(
      /FILTER \(WHERE media_type <> 'trailer'\)/
    );
  });

  it('answers zeros without a query for a member with no accounts', async () => {
    scopeRedis.get.mockResolvedValue(JSON.stringify({ serverUserIds: [], serverIds: [] }));
    await build({ userId: 'u-member', username: 'mia', role: 'member', serverIds: [] });

    const response = await app.inject({ url: '/stats/me' });

    expect(response.json()).toEqual({
      daysWatched: 0,
      currentStreak: 0,
      longestStreak: 0,
      totalWatchTimeMs: 0,
      firstPlay: null,
      biggestBinge: null,
      topGenres: [],
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("uses the owner's own accounts, not every account", async () => {
    vi.mocked(db.select).mockReturnValue(
      queryChain(vi.fn, [{ id: OWNER_ACCOUNT, serverId: 'server-1' }])
    );
    await build({ userId: 'u-owner', username: 'own', role: 'owner', serverIds: [] });

    await app.inject({ url: '/stats/me' });

    expect(sent()).toHaveLength(4);
    for (const params of sent()) expect(params).toContain(OWNER_ACCOUNT);
  });
});

describe('GET /stats/me/titles', () => {
  let app: FastifyInstance;
  const redis = { get: vi.fn(), setex: vi.fn() };
  const MEDIA = '33333333-3333-4333-8333-333333333333';
  const row = {
    id: MEDIA,
    media_type: 'show',
    title: 'The Bear',
    year: 2022,
    genres: ['Comedy'],
    normalized_title: 'the bear',
    latest_added_at: null,
    servers: [],
    poster_copy: null,
    plays: 8,
    watched_ms: '21600000',
    episodes: 8,
  };

  async function build(user: AuthUser): Promise<void> {
    app = Fastify({ logger: false });
    await app.register(sensible);
    app.decorate('authenticate', async (request: { user: AuthUser }) => {
      request.user = user;
    });
    app.decorate('requirePermission', permissionGuard(app));
    app.decorate('redis', redis as never);
    await app.register(meRoutes, { prefix: '/stats' });
  }

  const sent = () =>
    vi.mocked(db.execute).mock.calls.map((call) => renderSql(call[0] as SQL).params);

  beforeEach(() => {
    vi.clearAllMocks();
    redis.get.mockResolvedValue(null);
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
  });

  afterEach(async () => {
    await app.close();
  });

  it("ranks the member's own plays as poster rows with their own watched state", async () => {
    scopeRedis.get.mockResolvedValue(JSON.stringify({ serverUserIds: [OWN], serverIds: [] }));
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [row] } as never);
    await build({ userId: 'u-member', username: 'mia', role: 'member', serverIds: [] });

    const response = await app.inject({ url: '/stats/me/titles?period=month' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({
        mediaId: MEDIA,
        title: 'The Bear',
        plays: 8,
        watchTimeMs: 21_600_000,
        episodes: 8,
        rank: 1,
        watchedState: 'unwatched',
        posterUrl: null,
      }),
    ]);
    expect(sent()[0]).toContain(OWN);
    expect(redis.setex.mock.calls[0]?.[0]).toContain(
      `${REDIS_KEYS.MY_STATS}:member:u-member:titles:`
    );
  });

  it('answers an empty list without a query for a member with no accounts', async () => {
    scopeRedis.get.mockResolvedValue(JSON.stringify({ serverUserIds: [], serverIds: [] }));
    await build({ userId: 'u-member', username: 'mia', role: 'member', serverIds: [] });

    expect((await app.inject({ url: '/stats/me/titles' })).json()).toEqual({ data: [] });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("uses the owner's own accounts, not every account", async () => {
    vi.mocked(db.select).mockReturnValue(
      queryChain(vi.fn, [{ id: OWNER_ACCOUNT, serverId: 'server-1' }])
    );
    await build({ userId: 'u-owner', username: 'own', role: 'owner', serverIds: [] });

    await app.inject({ url: '/stats/me/titles' });

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain(OWNER_ACCOUNT);
  });
});
