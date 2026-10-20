/**
 * The per-library storage table, against a real database.
 *
 * Every library of the server gets a row, an empty one included, sized from
 * live items and versions: an item counts once however many sized versions it
 * has, while zero-byte versions and removed items count for nothing.
 *
 * Run with: pnpm --filter @tracearr/server test:integration storageLibraries
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import type { Redis } from 'ioredis';
import type { AuthUser, LibraryStorageResponse } from '@tracearr/shared';
import {
  createTestServer,
  createTestLibraryItem,
  createTestLibraryItemVersion,
} from '@tracearr/test-utils/factories';
import { createMockRedis } from '@tracearr/test-utils/mocks';
import { db } from '../../src/db/client.js';
import { libraries } from '../../src/db/schema.js';
import { libraryStorageRoute } from '../../src/routes/library/storage.js';
import { permissionGuard } from '../../src/lib/scope.js';

async function buildApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as FastifyRequest & { user: AuthUser }).user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));
  app.decorate('redis', createMockRedis() as unknown as Redis);
  await app.register(libraryStorageRoute, { prefix: '/library' });
  return app;
}

describe('storage per-library table', () => {
  it('lists a sized and an empty library of the server with live counts and bytes', async () => {
    const server = await createTestServer({ type: 'plex' });
    const otherServer = await createTestServer({ type: 'jellyfin' });
    await db.insert(libraries).values([
      { serverId: server.id, libraryId: '1', name: 'Movies', mediaType: 'movie' },
      { serverId: server.id, libraryId: '4', name: 'Music', mediaType: 'artist' },
      { serverId: otherServer.id, libraryId: 'f137a2dd', name: 'Films', mediaType: 'movies' },
    ]);

    const dune = await createTestLibraryItem({
      serverId: server.id,
      libraryId: '1',
      title: 'Dune: Part Two',
      year: 2024,
      withoutVersion: true,
    });
    await createTestLibraryItemVersion({
      libraryItemId: dune.id,
      serverVersionKey: 'v-4k',
      fileSize: 58_000_000_000,
      videoResolution: '4k',
    });
    await createTestLibraryItemVersion({
      libraryItemId: dune.id,
      serverVersionKey: 'v-1080',
      fileSize: 12_000_000_000,
      videoResolution: '1080p',
    });
    const unsized = await createTestLibraryItem({
      serverId: server.id,
      libraryId: '1',
      title: 'Past Lives',
      year: 2023,
      withoutVersion: true,
    });
    await createTestLibraryItemVersion({ libraryItemId: unsized.id, fileSize: 0 });
    await createTestLibraryItem({
      serverId: server.id,
      libraryId: '1',
      title: 'Oppenheimer',
      year: 2023,
      fileSize: 40_000_000_000,
      removedAt: new Date('2026-09-30T08:00:00Z'),
    });
    await createTestLibraryItem({
      serverId: otherServer.id,
      libraryId: 'f137a2dd',
      title: 'Aftersun',
      year: 2022,
      fileSize: 9_000_000_000,
    });

    const app = await buildApp({
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    });
    const response = await app.inject({
      method: 'GET',
      url: `/library/storage?serverId=${server.id}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json<LibraryStorageResponse>().libraries).toEqual([
      {
        libraryId: '1',
        name: 'Movies',
        mediaType: 'movie',
        itemCount: 1,
        sizeBytes: 70_000_000_000,
      },
      { libraryId: '4', name: 'Music', mediaType: 'artist', itemCount: 0, sizeBytes: 0 },
    ]);
  });
});
