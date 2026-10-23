/**
 * Library stale watch state against a real database: plays come from raw sessions by
 * rating key, so an unlinked imported play still marks its title watched, a resume chain
 * counts once, and a play under the counted threshold does not count.
 *
 * Run with: pnpm --filter @tracearr/server test:integration staleWatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import type { AuthUser } from '@tracearr/shared';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
  createTestLibraryItem,
} from '@tracearr/test-utils/factories';
import { getRedis } from '../../src/lib/redisShared.js';
import { permissionGuard } from '../../src/lib/scope.js';
import { libraryStaleRoute } from '../../src/routes/library/stale.js';

const DAY_MS = 86_400_000;
const THIRTY_MIN = 1_800_000;

interface StaleRow {
  id: string;
  category: string;
  watchCount: number;
  lastWatched: string | null;
}

let app: FastifyInstance | undefined;

async function buildApp(authUser: AuthUser): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  await instance.register(sensible);
  instance.decorate('authenticate', async (request: FastifyRequest) => {
    (request as FastifyRequest & { user: AuthUser }).user = authUser;
  });
  instance.decorate('requirePermission', permissionGuard(instance));
  instance.decorate('redis', getRedis() as never);
  await instance.register(libraryStaleRoute, { prefix: '/library' });
  return instance;
}

describe('/library/stale watch state', () => {
  beforeEach(async () => {
    await getRedis().flushdb();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('counts unlinked plays and resume chains once, and skips short plays', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const account = await createTestServerUser({ serverId: server.id, userId: user.id });

    const movie = await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'sw-movie',
      fileSize: 4_000_000_000,
    });
    const show = await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'sw-show',
      mediaType: 'show',
      withoutVersion: true,
    });
    for (const [ratingKey, itemIndex, fileSize] of [
      ['sw-e1', 1, 500_000_000],
      ['sw-e2', 2, 600_000_000],
    ] as const) {
      await createTestLibraryItem({
        serverId: server.id,
        ratingKey,
        mediaType: 'episode',
        grandparentRatingKey: 'sw-show',
        itemIndex,
        fileSize,
      });
    }
    const unwatched = await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'sw-unwatched',
      fileSize: 1_000_000_000,
    });

    const movieStart = new Date(Date.now() - 20 * DAY_MS);
    const movieStop = new Date(movieStart.getTime() + 2 * THIRTY_MIN);
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      ratingKey: 'sw-movie',
      mediaId: null,
      state: 'stopped',
      startedAt: movieStart,
      stoppedAt: movieStop,
      durationMs: 2 * THIRTY_MIN,
    });

    const chainStart = new Date(Date.now() - 10 * DAY_MS);
    const first = await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      ratingKey: 'sw-e1',
      mediaType: 'episode',
      state: 'stopped',
      startedAt: chainStart,
      stoppedAt: new Date(chainStart.getTime() + THIRTY_MIN),
      durationMs: THIRTY_MIN,
    });
    const resumeStop = new Date(chainStart.getTime() + 2 * THIRTY_MIN + 600_000);
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      ratingKey: 'sw-e1',
      mediaType: 'episode',
      state: 'stopped',
      startedAt: new Date(chainStart.getTime() + THIRTY_MIN + 600_000),
      stoppedAt: resumeStop,
      durationMs: THIRTY_MIN,
      referenceId: first.id,
    });
    const shortStart = new Date(Date.now() - 5 * DAY_MS);
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      ratingKey: 'sw-e2',
      mediaType: 'episode',
      state: 'stopped',
      startedAt: shortStart,
      stoppedAt: new Date(shortStart.getTime() + 60_000),
      durationMs: 60_000,
    });

    app = await buildApp({
      userId: crypto.randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [server.id],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/library/stale?serverId=${server.id}&staleDays=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const rows = new Map<string, StaleRow>(body.items.map((i: StaleRow) => [i.id, i]));

    const movieRow = rows.get(movie.id);
    expect(movieRow?.category).toBe('stale');
    expect(movieRow?.watchCount).toBe(1);
    expect(new Date(movieRow?.lastWatched ?? '').getTime()).toBe(movieStop.getTime());

    const showRow = rows.get(show.id);
    expect(showRow?.category).toBe('stale');
    expect(showRow?.watchCount).toBe(1);
    expect(new Date(showRow?.lastWatched ?? '').getTime()).toBe(resumeStop.getTime());

    const unwatchedRow = rows.get(unwatched.id);
    expect(unwatchedRow?.category).toBe('never_watched');
    expect(unwatchedRow?.watchCount).toBe(0);
    expect(unwatchedRow?.lastWatched).toBeNull();

    const expectedSummary = {
      neverWatched: { count: 1, sizeBytes: 1_000_000_000 },
      stale: { count: 2, sizeBytes: 5_100_000_000 },
      total: { count: 3, sizeBytes: 6_100_000_000 },
      threshold: { days: 1 },
    };
    expect(body.summary).toEqual(expectedSummary);

    // Past the last page the summary comes from the standalone summary query
    const emptyPage = await app.inject({
      method: 'GET',
      url: `/library/stale?serverId=${server.id}&staleDays=1&page=2&pageSize=25`,
    });
    expect(emptyPage.statusCode).toBe(200);
    const emptyBody = JSON.parse(emptyPage.body);
    expect(emptyBody.items).toEqual([]);
    expect(emptyBody.summary).toEqual(expectedSummary);
  });
});
