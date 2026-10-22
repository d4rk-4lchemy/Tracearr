/**
 * Image precache job: selection and warming against a real database and a
 * real (but instrumented) upstream fetch.
 *
 * imagePrecacheQueue.test.ts (services suite) proves the batching, concurrency
 * bound, and fail-open behavior with the database and imageProxy mocked; this
 * suite proves the actual "needs warming" decision, which lives in the real
 * SQL WHERE clause and the real on-disk cache-existence check that a mocked
 * db.select() can't honestly exercise.
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- imagePrecacheQueue
 */

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { Queue, Worker, type Job } from 'bullmq';
import { POSTER_IMAGE_SIZE, getRedisPrefix } from '@tracearr/shared';
import { createTestServer, createTestLibraryItem } from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { libraryItems } from '../../src/db/schema.js';
import {
  processImagePrecacheJob,
  type ImagePrecacheJobData,
} from '../../src/jobs/imagePrecacheQueue.js';
import { addSingleton } from '../../src/jobs/jobSafety.js';
import { setSetting } from '../../src/services/settings.js';
import {
  proxyImage,
  posterCacheEntryExists,
  posterCacheFileName,
  IMAGE_CACHE_DIR,
} from '../../src/services/imageProxy.js';

let testImage: Buffer;

beforeAll(async () => {
  testImage = await sharp({
    create: { width: 12, height: 12, channels: 3, background: { r: 40, g: 80, b: 160 } },
  })
    .jpeg()
    .toBuffer();
});

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(counter: { calls: number }): void {
  globalThis.fetch = (async () => {
    counter.calls++;
    return new Response(testImage, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as unknown as typeof fetch;
}

function makeJob(data: ImagePrecacheJobData): Job<ImagePrecacheJobData> {
  const job = {
    data,
    token: 'tok',
    updateData: vi.fn(async (next: ImagePrecacheJobData) => {
      job.data = next;
    }),
    extendLock: vi.fn().mockResolvedValue(1),
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  };
  return job as unknown as Job<ImagePrecacheJobData>;
}

/** The one cache file a poster warms - same derivation the job itself uses. */
function cacheFilePathFor(serverId: string, thumbPath: string): string {
  const { fileName, shard } = posterCacheFileName(serverId, thumbPath);
  return join(IMAGE_CACHE_DIR, shard, fileName);
}

describe('image precache job: real selection + warming behavior', () => {
  it('warms an item whose poster cache entry is missing even though dominant color is already set', async () => {
    const server = await createTestServer({ type: 'plex' });
    const { id, ratingKey } = await createTestLibraryItem({ serverId: server.id });
    const thumbPath = `/library/metadata/${ratingKey}/thumb/${randomUUID()}`;
    await db
      .update(libraryItems)
      .set({ thumbPath, dominantColor: '#112233' })
      .where(eq(libraryItems.id, id));

    const counter = { calls: 0 };
    stubFetch(counter);

    const result = await processImagePrecacheJob(makeJob({ serverId: server.id, cursor: null }));

    expect(result).toEqual({ processed: 1 });
    expect(counter.calls).toBe(1);
    await expect(posterCacheEntryExists(server.id, thumbPath)).resolves.toBe(true);
  });

  it('skips a fully-warmed item (poster cached, dominant color set)', async () => {
    const server = await createTestServer({ type: 'plex' });
    const { id, ratingKey } = await createTestLibraryItem({ serverId: server.id });
    const thumbPath = `/library/metadata/${ratingKey}/thumb/${randomUUID()}`;
    await db.update(libraryItems).set({ thumbPath }).where(eq(libraryItems.id, id));

    const counter = { calls: 0 };
    stubFetch(counter);
    await proxyImage({
      serverId: server.id,
      imagePath: thumbPath,
      ...POSTER_IMAGE_SIZE,
      fallback: 'poster',
    });
    expect(counter.calls).toBe(1);

    await db.update(libraryItems).set({ dominantColor: '#112233' }).where(eq(libraryItems.id, id));

    counter.calls = 0;
    const result = await processImagePrecacheJob(makeJob({ serverId: server.id, cursor: null }));

    expect(result).toEqual({ processed: 1 });
    expect(counter.calls).toBe(0);
  });

  it('re-warms an item whose poster cache file was evicted from disk', async () => {
    const server = await createTestServer({ type: 'plex' });
    const { id, ratingKey } = await createTestLibraryItem({ serverId: server.id });
    const thumbPath = `/library/metadata/${ratingKey}/thumb/${randomUUID()}`;
    await db.update(libraryItems).set({ thumbPath }).where(eq(libraryItems.id, id));

    const counter = { calls: 0 };
    stubFetch(counter);
    await proxyImage({
      serverId: server.id,
      imagePath: thumbPath,
      ...POSTER_IMAGE_SIZE,
      fallback: 'poster',
    });
    expect(counter.calls).toBe(1);

    await unlink(cacheFilePathFor(server.id, thumbPath));
    await expect(posterCacheEntryExists(server.id, thumbPath)).resolves.toBe(false);

    counter.calls = 0;
    const result = await processImagePrecacheJob(makeJob({ serverId: server.id, cursor: null }));

    expect(result).toEqual({ processed: 1 });
    expect(counter.calls).toBe(1);
    await expect(posterCacheEntryExists(server.id, thumbPath)).resolves.toBe(true);
  });

  it('sinceUpdatedAt scopes the pass to items touched on/after the watermark', async () => {
    const server = await createTestServer({ type: 'plex' });
    const stale = await createTestLibraryItem({ serverId: server.id });
    const fresh = await createTestLibraryItem({ serverId: server.id });
    const staleThumb = `/library/metadata/${stale.ratingKey}/thumb/${randomUUID()}`;
    const freshThumb = `/library/metadata/${fresh.ratingKey}/thumb/${randomUUID()}`;
    const watermark = new Date('2026-01-15T00:00:00.000Z');

    // Stale item was last touched before the watermark - e.g. a full-scan
    // pass over byte-identical rows that never bumped updated_at (Fix 3).
    await db
      .update(libraryItems)
      .set({ thumbPath: staleThumb, updatedAt: new Date(watermark.getTime() - 60_000) })
      .where(eq(libraryItems.id, stale.id));
    // Fresh item is newly added/changed since the watermark.
    await db
      .update(libraryItems)
      .set({ thumbPath: freshThumb, updatedAt: new Date(watermark.getTime() + 60_000) })
      .where(eq(libraryItems.id, fresh.id));

    const counter = { calls: 0 };
    stubFetch(counter);

    const result = await processImagePrecacheJob(
      makeJob({ serverId: server.id, cursor: null, sinceUpdatedAt: watermark.toISOString() })
    );

    expect(result).toEqual({ processed: 1 });
    expect(counter.calls).toBe(1); // only the fresh item's one warm
    await expect(posterCacheEntryExists(server.id, freshThumb)).resolves.toBe(true);
    await expect(posterCacheEntryExists(server.id, staleThumb)).resolves.toBe(false);
  });

  it('leaves untagged Jellyfin/Emby paths to live browsing', async () => {
    const server = await createTestServer({ type: 'jellyfin' });
    const tagged = await createTestLibraryItem({ serverId: server.id });
    const untagged = await createTestLibraryItem({ serverId: server.id });
    const taggedThumb = `/Items/${tagged.ratingKey}/Images/Primary?tag=${randomUUID()}`;
    const untaggedThumb = `/Items/${untagged.ratingKey}/Images/Primary`;
    await db
      .update(libraryItems)
      .set({ thumbPath: taggedThumb })
      .where(eq(libraryItems.id, tagged.id));
    await db
      .update(libraryItems)
      .set({ thumbPath: untaggedThumb })
      .where(eq(libraryItems.id, untagged.id));

    const counter = { calls: 0 };
    stubFetch(counter);

    const result = await processImagePrecacheJob(makeJob({ serverId: server.id, cursor: null }));

    expect(result).toEqual({ processed: 1 });
    expect(counter.calls).toBe(1);
    await expect(posterCacheEntryExists(server.id, taggedThumb)).resolves.toBe(true);
    await expect(posterCacheEntryExists(server.id, untaggedThumb)).resolves.toBe(false);
  });
});

describe('image precache pass: restart mid-pass', () => {
  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
  const connection = { url: REDIS_URL };
  const prefix = `${getRedisPrefix()}bull`;
  const LOCK_DURATION_MS = 1500;
  const STALLED_INTERVAL_MS = 300;
  const shortLock = {
    connection,
    prefix,
    lockDuration: LOCK_DURATION_MS,
    stalledInterval: STALLED_INTERVAL_MS,
    maxStalledCount: 2,
  };
  const processor = (job: Job<ImagePrecacheJobData>, _token?: string, signal?: AbortSignal) =>
    processImagePrecacheJob(job, signal);

  it('one job finishes the pass after its worker dies, warming each poster once', async () => {
    await setSetting('imagePrecacheEnabled', true);
    const server = await createTestServer({ type: 'plex' });
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const { id, ratingKey } = await createTestLibraryItem({ serverId: server.id });
      await db
        .update(libraryItems)
        .set({ thumbPath: `/library/metadata/${ratingKey}/thumb/${randomUUID()}` })
        .where(eq(libraryItems.id, id));
      ids.push(id);
    }
    ids.sort();

    const queue = new Queue<ImagePrecacheJobData>('image-precache', { connection, prefix });
    const workerA = new Worker<ImagePrecacheJobData>('image-precache', processor, shortLock);
    const workerB = new Worker<ImagePrecacheJobData>('image-precache', processor, {
      ...shortLock,
      autorun: false,
    });
    workerA.on('error', () => {});
    workerB.on('error', () => {});

    try {
      const counter = { calls: 0 };
      stubFetch(counter);
      const warm = globalThis.fetch;
      let cursorAtCrash: string | null | undefined;
      let crashTime = 0;
      const activeA = once(workerA, 'active');
      const { jobId } = await addSingleton(
        queue,
        'precache',
        { serverId: server.id, cursor: null },
        `precache-${server.id}`
      );
      await activeA;
      void workerB.run();
      const activeB = once(workerB, 'active');
      const completedB = once(workerB, 'completed');

      // Concurrency is 1 here, so call 51 is A's first warm after its first checkpoint.
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        if (counter.calls === 50) {
          cursorAtCrash = (await queue.getJob(jobId))?.data.cursor;
          // The checkpoint extended the lock to the production 60s; crash only once A's
          // lock renewer has brought it back to this worker's lockDuration.
          const client = await queue.getBackend().client;
          const lockKey = `${queue.toKey(jobId)}:lock`;
          while ((await client.pttl(lockKey)) > LOCK_DURATION_MS) await sleep(25);
          const clientA = await workerA.getBackend().client;
          crashTime = Date.now();
          clientA.disconnect();
        }
        return warm(...args);
      }) as typeof fetch;

      await Promise.race([
        activeB,
        // Generous: under a full-tier run the stalled check drifts seconds past its interval
        sleep(LOCK_DURATION_MS + 3 * STALLED_INTERVAL_MS + 10_000).then(() => {
          throw new Error('timed out waiting for worker B to reclaim the pass');
        }),
      ]);
      const reclaimedMs = Date.now() - crashTime;
      await completedB;

      expect(cursorAtCrash).toBe(ids[49]);
      expect(reclaimedMs).toBeLessThanOrEqual(LOCK_DURATION_MS + 2 * STALLED_INTERVAL_MS + 9500);
      expect(counter.calls).toBe(120);
      expect(await queue.getCompletedCount()).toBe(1);
      expect(await queue.getWaitingCount()).toBe(0);
      const finished = await queue.getJob(jobId);
      expect(finished?.data.processedItems).toBe(120);
      expect(finished?.data.cursor).toBe(ids[119]);
    } finally {
      await workerA.close(true).catch(() => {});
      await workerB.close(true).catch(() => {});
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 30000);
});
