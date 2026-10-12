/**
 * GET /stats/me against a real database.
 *
 * me.test.ts mocks db.execute, so it proves whose accounts reach the SQL but not the SQL itself:
 * local days in the viewer's timezone, the qualifying-play filter, the binge grouping on
 * daily_content_engagement and the canonical genre fold on user_media_plays_daily.
 *
 * Run with: pnpm --filter @tracearr/server test:integration myStats
 */

import { randomInt } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import { eq, sql } from 'drizzle-orm';
import type { AuthUser, MyStats } from '@tracearr/shared';
import {
  createTestOwner,
  createTestServer,
  createTestServerUser,
  createTestSession,
  createTestUser,
} from '@tracearr/test-utils/factories';
import { createMockRedis } from '@tracearr/test-utils/mocks';
import { db } from '../../src/db/client.js';
import { media } from '../../src/db/schema.js';
import { meRoutes } from '../../src/routes/stats/me.js';
import { permissionGuard } from '../../src/lib/scope.js';
import { resolveMediaForItem } from '../../src/services/library/mediaResolutionService.js';

async function seedMedia(
  serverId: string,
  mediaType: 'movie' | 'show' | 'episode',
  title: string,
  genres: string[] | null,
  showMediaId?: string
): Promise<string> {
  const id = await resolveMediaForItem({
    mediaType,
    ...(mediaType === 'movie' ? { tmdbId: randomInt(1e9) } : { tvdbId: randomInt(1e9) }),
    title,
    year: 2020,
    serverId,
    ratingKey: `${title}-${randomInt(1e9)}`,
    showMediaId,
  });
  await db.update(media).set({ genres }).where(eq(media.id, id));
  return id;
}

describe('GET /stats/me against a real database', () => {
  it("returns the owner's own moments in the viewer's timezone", async () => {
    const server = await createTestServer({ type: 'plex' });
    const owner = await createTestOwner();
    const account = await createTestServerUser({ serverId: server.id, userId: owner.id });
    const removed = await createTestServerUser({
      serverId: (await createTestServer({ type: 'jellyfin' })).id,
      userId: owner.id,
      removedAt: new Date(),
    });
    const someoneElse = await createTestServerUser({
      serverId: server.id,
      userId: (await createTestUser()).id,
    });

    const film = await seedMedia(server.id, 'movie', 'First Film', ['Action']);
    const horror = await seedMedia(server.id, 'movie', 'Not Mine', ['Horror']);
    const bingeShow = await seedMedia(server.id, 'show', 'Binge Show', ['Drama']);
    const otherShow = await seedMedia(server.id, 'show', 'Other Show', ['Comedy']);
    const episodes = await Promise.all(
      [1, 2, 3].map((n) => seedMedia(server.id, 'episode', `Binge Ep ${n}`, null, bingeShow))
    );
    const otherEpisodes = await Promise.all(
      [1, 2].map((n) => seedMedia(server.id, 'episode', `Other Ep ${n}`, null, otherShow))
    );

    const play = (
      serverUserId: string,
      startedAt: Date,
      opts: {
        mediaId: string;
        mediaTitle: string;
        mediaType?: 'movie' | 'episode';
        showMediaId?: string;
        grandparentTitle?: string;
        ratingKey?: string;
        durationMs?: number;
      }
    ) =>
      createTestSession({
        serverId: server.id,
        serverUserId,
        state: 'stopped',
        referenceId: null,
        startedAt,
        stoppedAt: startedAt,
        mediaType: opts.mediaType ?? 'movie',
        mediaTitle: opts.mediaTitle,
        grandparentTitle: opts.grandparentTitle ?? null,
        mediaId: opts.mediaId,
        showMediaId: opts.showMediaId ?? null,
        ratingKey: opts.ratingKey ?? opts.mediaId,
        durationMs: opts.durationMs ?? 600_000,
        totalDurationMs: 7_200_000,
        progressMs: opts.durationMs ?? 600_000,
      });
    const movie = { mediaId: film, mediaTitle: 'First Film' };
    const notMine = { mediaId: horror, mediaTitle: 'Not Mine' };

    // Etc/GMT+5 is UTC-5: 03:00 UTC on Mar 1 is the evening of Feb 28 locally.
    await play(account.id, new Date('2026-03-01T03:00:00Z'), movie);
    await play(account.id, new Date('2026-03-01T20:00:00Z'), movie);
    await play(account.id, new Date('2026-03-02T15:00:00Z'), movie);
    await play(account.id, new Date('2026-03-05T15:00:00Z'), { ...movie, durationMs: 60_000 });
    await play(account.id, new Date(Date.now() - 60_000), movie);
    await play(removed.id, new Date('2025-12-01T12:00:00Z'), notMine);
    await play(someoneElse.id, new Date('2026-01-01T12:00:00Z'), notMine);

    const binge = { mediaType: 'episode' as const, grandparentTitle: 'Binge Show' };
    // The first episode twice: a rewatch the same day is still three episodes.
    for (const [i, episode] of [...episodes, ...episodes.slice(0, 1)].entries()) {
      await play(account.id, new Date(Date.UTC(2026, 2, 10, 12 + i)), {
        ...binge,
        mediaId: episode,
        mediaTitle: 'Binge Ep',
        showMediaId: bingeShow,
      });
    }
    for (const episode of otherEpisodes) {
      await play(account.id, new Date('2026-03-11T12:00:00Z'), {
        mediaType: 'episode',
        grandparentTitle: 'Other Show',
        mediaId: episode,
        mediaTitle: 'Other Ep',
        showMediaId: otherShow,
      });
    }

    for (const view of ['daily_content_engagement', 'user_media_plays_daily']) {
      await db.execute(sql`CALL refresh_continuous_aggregate(${view}::regclass, NULL, NULL)`);
    }

    const app = Fastify({ logger: false });
    await app.register(sensible);
    const user: AuthUser = {
      userId: owner.id,
      username: owner.username,
      role: 'owner',
      serverIds: [],
    };
    app.decorate('authenticate', async (request: FastifyRequest) => {
      (request as FastifyRequest & { user: AuthUser }).user = user;
    });
    app.decorate('requirePermission', permissionGuard(app));
    app.decorate('redis', createMockRedis() as never);
    await app.register(meRoutes, { prefix: '/stats' });

    const res = await app.inject({ url: '/stats/me?timezone=Etc/GMT%2B5' });
    const body = res.json<MyStats>();

    expect(res.statusCode).toBe(200);
    // Feb 28, Mar 1, Mar 2 locally, then Mar 10, Mar 11 and today; the 60 s play on Mar 5 is not one.
    expect(body).toMatchObject({ daysWatched: 6, longestStreak: 3, currentStreak: 1 });
    expect(body.firstPlay).toEqual({
      mediaTitle: 'First Film',
      grandparentTitle: null,
      mediaId: film,
      startedAt: '2026-03-01T03:00:00.000Z',
    });
    expect(body.biggestBinge).toEqual({
      showTitle: 'Binge Show',
      showMediaId: bingeShow,
      episodes: 3,
      day: '2026-03-10',
    });
    expect(body.topGenres).toEqual([
      { genre: 'Action', plays: 4 },
      { genre: 'Drama', plays: 4 },
      { genre: 'Comedy', plays: 2 },
    ]);

    await app.close();
  });
});
