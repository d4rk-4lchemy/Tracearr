/**
 * Downloads stats route tests
 *
 * The query is mocked: these assert the staff gate, the parsed query and the WHERE handed to it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser, DownloadsStats } from '@tracearr/shared';
import { renderSql } from '../../../test/helpers.js';

const { scopeRedis } = vi.hoisted(() => ({
  scopeRedis: {
    get: vi.fn(async () => JSON.stringify({ serverUserIds: [], serverIds: [] })),
    set: vi.fn(),
  },
}));

vi.mock('../../../db/client.js', () => ({ db: {} }));
vi.mock('../../../lib/redisShared.js', () => ({ getRedis: () => scopeRedis }));

vi.mock('../../../services/downloads/queries.js', () => ({
  queryDownloadsStats: vi.fn(),
}));

import { queryDownloadsStats } from '../../../services/downloads/queries.js';
import { downloadsRoutes } from '../downloads.js';
import { permissionGuard } from '../../../lib/scope.js';

const mockStats = vi.mocked(queryDownloadsStats);

const stats: DownloadsStats = {
  total: 3,
  people: 2,
  totalBytes: 4096,
  topTitle: { title: 'Dune', count: 2, libraryItemId: null },
  rows: [],
  page: 1,
  pageSize: 20,
};

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));
  await app.register(downloadsRoutes, { prefix: '/stats' });
  return app;
}

const owner = (): AuthUser => ({
  userId: randomUUID(),
  username: 'owner',
  role: 'owner',
  serverIds: [],
});

describe('GET /stats/downloads', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStats.mockResolvedValue(stats);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 to a member', async () => {
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'member',
      role: 'member',
      serverIds: [],
    });
    const response = await app.inject({ url: '/stats/downloads' });
    expect(response.statusCode).toBe(403);
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('returns the cards and rows for the range with page defaults', async () => {
    app = await buildTestApp(owner());
    const response = await app.inject({ url: '/stats/downloads?period=month' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(stats);
    expect(mockStats).toHaveBeenCalledWith(expect.anything(), 1, 20);
    const { sql: text } = renderSql(mockStats.mock.calls[0]![0]);
    expect(text).toContain('media_downloads.first_seen_at >=');
  });

  it('bounds a custom range at both ends and passes the page through', async () => {
    app = await buildTestApp(owner());
    const response = await app.inject({
      url: '/stats/downloads?period=custom&startDate=2026-01-01T00:00:00Z&endDate=2026-02-01T00:00:00Z&page=3&pageSize=50',
    });
    expect(response.statusCode).toBe(200);
    expect(mockStats).toHaveBeenCalledWith(expect.anything(), 3, 50);
    const { sql: text } = renderSql(mockStats.mock.calls[0]![0]);
    expect(text).toContain('media_downloads.first_seen_at <');
  });

  it('filters to the requested server', async () => {
    app = await buildTestApp(owner());
    const serverId = randomUUID();
    const response = await app.inject({ url: `/stats/downloads?serverId=${serverId}` });
    expect(response.statusCode).toBe(200);
    const { sql: text, params } = renderSql(mockStats.mock.calls[0]![0]);
    expect(text).toContain('media_downloads.server_id');
    expect(params).toContain(serverId);
  });

  it('rejects an invalid query', async () => {
    app = await buildTestApp(owner());
    const response = await app.inject({ url: '/stats/downloads?page=0' });
    expect(response.statusCode).toBe(400);
  });
});
