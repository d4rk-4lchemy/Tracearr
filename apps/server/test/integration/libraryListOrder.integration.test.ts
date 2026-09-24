/**
 * Library list ordering against a real database
 *
 * The Alpine image compares text by bytes, so a title sort has to go through
 * the catalog sort key, and a byte count cast to text sorts as a string. The
 * stale list pins its page order with an outer ORDER BY on the same key.
 *
 * Run with: pnpm --filter @tracearr/server test:integration libraryListOrder
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { DuplicatesResponse } from '@tracearr/shared';
import { resetTestDb } from '@tracearr/test-utils/db';
import {
  createTestServer,
  createTestLibraryItem,
  createTestLibraryItemVersion,
} from '@tracearr/test-utils/factories';
import { createMockRedis } from '@tracearr/test-utils/mocks';
import { db } from '../../src/db/client.js';
import { libraryStaleRoute } from '../../src/routes/library/stale.js';
import { libraryDuplicatesRoute } from '../../src/routes/library/duplicates.js';

const GB = 1024 ** 3;

const TITLES: { title: string; sortTitle: string }[] = [
  { title: 'Zed', sortTitle: 'zed' },
  { title: 'alice', sortTitle: 'alice' },
  { title: '_x', sortTitle: 'x' },
  { title: 'Émile', sortTitle: 'emile' },
  { title: 'Bob', sortTitle: 'bob' },
];

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('redis', createMockRedis() as unknown as Redis);
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: 'owner', username: 'owner', role: 'owner', serverIds: [] };
  });
  await app.register(libraryStaleRoute, { prefix: '/library' });
  await app.register(libraryDuplicatesRoute, { prefix: '/library' });
  return app;
}

async function seed() {
  const server = await createTestServer({ type: 'plex' });
  for (const entry of TITLES) {
    const mediaId = randomUUID();
    await db.execute(sql`
      INSERT INTO media (id, media_type, match_key, title, sort_title)
      VALUES (${mediaId}, 'movie', ${`movie:title:${entry.sortTitle}:0`}, ${entry.title}, ${entry.sortTitle})
    `);
    if (entry.title === 'Zed') {
      const item = await createTestLibraryItem({
        serverId: server.id,
        title: entry.title,
        mediaId,
        withoutVersion: true,
      });
      await createTestLibraryItemVersion({ libraryItemId: item.id, fileSize: 9 * GB });
      await createTestLibraryItemVersion({ libraryItemId: item.id, fileSize: 12 * GB });
    } else {
      await createTestLibraryItem({
        serverId: server.id,
        title: entry.title,
        mediaId,
        fileSize: 1 * GB,
      });
    }
  }
}

describe('library list ordering', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await resetTestDb();
    await seed();
    app = await buildApp();
    return () => app.close();
  });

  it('lists stale content by title in key order with the page order pinned', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/library/stale?sortBy=title&sortOrder=asc&pageSize=3',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { title: string }) => i.title)).toEqual([
      'alice',
      'Bob',
      'Émile',
    ]);
    const page2 = await app.inject({
      method: 'GET',
      url: '/library/stale?sortBy=title&sortOrder=asc&pageSize=3&page=2',
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items.map((i: { title: string }) => i.title)).toEqual(['_x', 'Zed']);
  });

  it('orders duplicate versions by byte size, largest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/library/duplicates?includeFuzzy=false' });
    expect(res.statusCode).toBe(200);
    const body = res.json<DuplicatesResponse>();
    const zed = body.duplicates.flatMap((g) => g.items).find((i) => i.title === 'Zed');
    expect(zed?.versions.map((v) => v.fileSize)).toEqual([12 * GB, 9 * GB]);
  });
});
