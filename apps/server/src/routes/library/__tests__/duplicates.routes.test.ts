/**
 * Library duplicates route tests
 *
 * db.execute is mocked (this suite's convention, see catalog.routes.test.ts),
 * so these prove the grouping, mirror-dedup, and storage math over canned
 * rows - not SQL correctness. The shapes mirror real installs: the
 * cross-library merged-versions case is issue #958, the byte-identical
 * same-item pair and the near-identical remux pair are shapes observed on a
 * production database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser, DuplicatesResponse } from '@tracearr/shared';

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../../../db/client.js';
import { libraryDuplicatesRoute } from '../duplicates.js';

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
  app.decorate('redis', redis as never);
  await app.register(libraryDuplicatesRoute, { prefix: '/library' });
  return app;
}

function createOwnerUser(): AuthUser {
  return { userId: randomUUID(), username: 'owner', role: 'owner', serverIds: [] };
}

const SERVER_A = randomUUID();
const SERVER_B = randomUUID();

interface ItemRowInput {
  id: string;
  serverId?: string;
  libraryId?: string;
  libraryName?: string;
  title?: string;
  fileSize?: number;
  resolution?: string;
}

function itemRow(input: ItemRowInput) {
  return {
    id: input.id,
    server_id: input.serverId ?? SERVER_A,
    server_name: 'Server',
    library_id: input.libraryId ?? 'lib-1',
    library_name: input.libraryName ?? 'Movies',
    title: input.title ?? 'Some Movie',
    year: 2023,
    media_type: 'movie',
    file_size: input.fileSize != null ? String(input.fileSize) : null,
    video_resolution: input.resolution ?? '4k',
  };
}

function versionRow(itemId: string, fileSize: number, resolution = '4k', path = '/a.mkv') {
  return {
    library_item_id: itemId,
    video_resolution: resolution,
    video_codec: 'hevc',
    file_size: String(fileSize),
    file_path: path,
  };
}

/**
 * Queue the route's four db.execute calls for an includeFuzzy=false request:
 * id matches, version groups, item details, version rows.
 */
function mockQueries(opts: {
  idMatches?: unknown[];
  versionGroups?: unknown[];
  items?: unknown[];
  versions?: unknown[];
}) {
  const execute = vi.mocked(db.execute);
  execute.mockResolvedValueOnce({ rows: opts.idMatches ?? [] } as never);
  execute.mockResolvedValueOnce({ rows: opts.versionGroups ?? [] } as never);
  if ((opts.idMatches?.length ?? 0) > 0 || (opts.versionGroups?.length ?? 0) > 0) {
    execute.mockResolvedValueOnce({ rows: opts.items ?? [] } as never);
    execute.mockResolvedValueOnce({ rows: opts.versions ?? [] } as never);
  }
}

async function requestDuplicates(app: FastifyInstance): Promise<DuplicatesResponse> {
  const response = await app.inject({
    method: 'GET',
    url: '/library/duplicates?includeFuzzy=false',
  });
  expect(response.statusCode).toBe(200);
  return response.json<DuplicatesResponse>();
}

describe('GET /library/duplicates', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(createOwnerUser(), createSpyRedis());
  });

  it('counts mirrored cross-library versions once (issue #958 shape)', async () => {
    // One Jellyfin server, the same movie in Movies and Movies 4K via the
    // merge-versions plugin: two items, each listing BOTH physical files.
    const itemX = randomUUID();
    const itemY = randomUUID();
    mockQueries({
      idMatches: [
        {
          match_key: 'tt0000001',
          match_type: 'imdb',
          confidence: 100,
          server_ids: [SERVER_A],
          item_ids: [itemX, itemY],
          server_count: 1,
        },
      ],
      versionGroups: [
        { id: itemX, server_id: SERVER_A },
        { id: itemY, server_id: SERVER_A },
      ],
      items: [
        itemRow({ id: itemX, libraryId: 'lib-movies', libraryName: 'Movies', fileSize: 160 }),
        itemRow({ id: itemY, libraryId: 'lib-4k', libraryName: 'Movies 4K', fileSize: 160 }),
      ],
      versions: [
        versionRow(itemX, 100, '4k', '/movies/a-4k.mkv'),
        versionRow(itemX, 60, '1080p', '/movies/a-1080.mkv'),
        versionRow(itemY, 100, '4k', '/movies4k/a-4k.mkv'),
        versionRow(itemY, 60, '1080p', '/movies4k/a-1080.mkv'),
      ],
    });

    const body = await requestDuplicates(app);

    expect(body.summary.totalGroups).toBe(1);
    const group = body.duplicates[0]!;
    // Two physical files, not four
    expect(group.uniqueFileCount).toBe(2);
    // Byte math already deduped mirrors; both stay pinned
    expect(group.totalStorageBytes).toBe(160);
    expect(group.potentialSavingsBytes).toBe(60);
    // Every file is still listed under its library entry, but the second
    // listing of each physical file is flagged as a mirror
    const allVersions = group.items.flatMap((item) => item.versions);
    expect(allVersions).toHaveLength(4);
    expect(allVersions.filter((v) => v.isMirror)).toHaveLength(2);
    expect(allVersions.filter((v) => !v.isMirror)).toHaveLength(2);
  });

  it('does not report a byte-identical same-item pair as a duplicate', async () => {
    // The same release present twice under one item (renamed folder leaving
    // a second directory entry): equal byte size means the same physical
    // file everywhere else in the codebase, so it is not a reclaimable dup.
    const itemZ = randomUUID();
    mockQueries({
      versionGroups: [{ id: itemZ, server_id: SERVER_A }],
      items: [itemRow({ id: itemZ, fileSize: 1000 })],
      versions: [
        versionRow(itemZ, 500, '4k', '/movies/x and y.mkv'),
        versionRow(itemZ, 500, '4k', '/movies/x & y.mkv'),
      ],
    });

    const body = await requestDuplicates(app);

    expect(body.summary.totalGroups).toBe(0);
    expect(body.duplicates).toHaveLength(0);
  });

  it('reports a real same-item version pair with distinct sizes', async () => {
    const itemW = randomUUID();
    mockQueries({
      versionGroups: [{ id: itemW, server_id: SERVER_A }],
      items: [itemRow({ id: itemW, fileSize: 1199 })],
      versions: [versionRow(itemW, 600, '4k', '/a.mkv'), versionRow(itemW, 599, '4k', '/b.mkv')],
    });

    const body = await requestDuplicates(app);

    expect(body.summary.totalGroups).toBe(1);
    const group = body.duplicates[0]!;
    expect(group.matchType).toBe('version');
    expect(group.uniqueFileCount).toBe(2);
    expect(group.totalStorageBytes).toBe(1199);
    expect(group.potentialSavingsBytes).toBe(599);
  });

  it('keeps classic cross-server duplicates intact', async () => {
    const itemA = randomUUID();
    const itemB = randomUUID();
    mockQueries({
      idMatches: [
        {
          match_key: 'tt0000002',
          match_type: 'imdb',
          confidence: 100,
          server_ids: [SERVER_A, SERVER_B],
          item_ids: [itemA, itemB],
          server_count: 2,
        },
      ],
      items: [
        itemRow({ id: itemA, serverId: SERVER_A, fileSize: 900, resolution: '4k' }),
        itemRow({ id: itemB, serverId: SERVER_B, fileSize: 400, resolution: '1080p' }),
      ],
      versions: [],
    });

    const body = await requestDuplicates(app);

    expect(body.summary.totalGroups).toBe(1);
    const group = body.duplicates[0]!;
    expect(group.serverCount).toBe(2);
    expect(group.uniqueFileCount).toBe(2);
    expect(group.totalStorageBytes).toBe(1300);
    expect(group.potentialSavingsBytes).toBe(400);
  });
});
