/**
 * User devices route tests
 *
 * db.execute is mocked with the sessions rows first and the downloads rows second.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser, UserDevice } from '@tracearr/shared';
import type * as QueriesModule from '../queries.js';

vi.mock('../../../db/client.js', () => ({ db: { execute: vi.fn() } }));

vi.mock('../queries.js', async (importActual) => ({
  ...(await importActual<typeof QueriesModule>()),
  resolveIdentityScopedServerUserIds: vi.fn(),
}));

import { db } from '../../../db/client.js';
import { resolveIdentityScopedServerUserIds } from '../queries.js';
import { devicesRoutes } from '../devices.js';
import { permissionGuard } from '../../../lib/scope.js';

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));
  await app.register(devicesRoutes, { prefix: '/users' });
  return app;
}

const noGeo = { geo_city: null, geo_region: null, geo_country: null, is_local: true };
const noIdentity = { player_name: null, product: null, device: null, platform: null };

describe('GET /users/:id/devices download counts', () => {
  let app: FastifyInstance;
  const id = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveIdentityScopedServerUserIds).mockResolvedValue({
      serverUser: { id, serverId: randomUUID(), userId: randomUUID() },
      ids: [id],
    });
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [
          {
            device_id: 'tv',
            ...noIdentity,
            started_at: '2026-10-01T00:00:00Z',
            ...noGeo,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            device_id: 'tv',
            ...noIdentity,
            ...noGeo,
            download_count: 2,
            last_seen_at: '2026-10-02T00:00:00Z',
          },
          {
            device_id: 'phone',
            ...noIdentity,
            ...noGeo,
            download_count: 3,
            last_seen_at: '2026-10-03T00:00:00Z',
          },
        ],
      } as never);
  });

  afterEach(async () => {
    await app.close();
  });

  it('counts downloads per device and lists a device that only downloaded', async () => {
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    });
    const response = await app.inject({ url: `/users/${id}/devices` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json<{ data: UserDevice[] }>();
    expect(data.find((d) => d.deviceId === 'tv')).toMatchObject({
      sessionCount: 1,
      downloadCount: 2,
    });
    expect(data.find((d) => d.deviceId === 'phone')).toMatchObject({
      sessionCount: 0,
      downloadCount: 3,
      lastSeenAt: '2026-10-03T00:00:00.000Z',
    });
  });

  it('groups Dispatcharr connections by stable device alongside provider downloads', async () => {
    const session = {
      ...noIdentity,
      ...noGeo,
      started_at: '2026-10-01T00:00:00Z',
    };
    vi.mocked(db.execute)
      .mockReset()
      .mockResolvedValueOnce({
        rows: [
          { ...session, device_id: 'connection-1', dispatcharr_device_id: 'dispatcharr-tv' },
          { ...session, device_id: 'connection-2', dispatcharr_device_id: 'dispatcharr-tv' },
          { ...session, device_id: 'connection-3', dispatcharr_device_id: 'dispatcharr-phone' },
          { ...session, device_id: 'plex-tv', dispatcharr_device_id: null },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            device_id: 'plex-tv',
            ...noIdentity,
            ...noGeo,
            download_count: 2,
            last_seen_at: '2026-10-02T00:00:00Z',
          },
        ],
      } as never);
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    });

    const response = await app.inject({ url: `/users/${id}/devices` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json<{ data: UserDevice[] }>();
    expect(data).toHaveLength(3);
    expect(data.find((device) => device.deviceId === 'dispatcharr-tv')).toMatchObject({
      sessionCount: 2,
      downloadCount: 0,
    });
    expect(data.find((device) => device.deviceId === 'dispatcharr-phone')).toMatchObject({
      sessionCount: 1,
      downloadCount: 0,
    });
    expect(data.find((device) => device.deviceId === 'plex-tv')).toMatchObject({
      sessionCount: 1,
      downloadCount: 2,
    });
  });

  it('dates a device by its latest session or download and places a download-only device from the download', async () => {
    vi.mocked(db.execute)
      .mockReset()
      .mockResolvedValueOnce({
        rows: [{ device_id: 'tv', ...noIdentity, started_at: '2025-10-20T00:00:00Z', ...noGeo }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            device_id: 'tv',
            ...noIdentity,
            geo_city: 'Lisbon',
            geo_region: null,
            geo_country: 'PT',
            is_local: false,
            download_count: 1,
            last_seen_at: '2026-10-20T00:00:00Z',
          },
          {
            device_id: 'phone',
            ...noIdentity,
            geo_city: 'Lisbon',
            geo_region: null,
            geo_country: 'PT',
            is_local: null,
            download_count: 1,
            last_seen_at: '2026-10-19T00:00:00Z',
          },
          {
            device_id: 'tablet',
            ...noIdentity,
            geo_city: null,
            geo_region: null,
            geo_country: null,
            is_local: null,
            download_count: 1,
            last_seen_at: '2026-10-18T00:00:00Z',
          },
        ],
      } as never);
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    });

    const { data } = (await app.inject({ url: `/users/${id}/devices` })).json<{
      data: UserDevice[];
    }>();

    expect(data.map((d) => d.deviceId)).toEqual(['tv', 'phone', 'tablet']);
    expect(data[0]).toMatchObject({
      lastSeenAt: '2026-10-20T00:00:00.000Z',
      locations: [expect.objectContaining({ isLocal: true, sessionCount: 1 })],
    });
    expect(data[1]?.locations).toEqual([
      {
        city: 'Lisbon',
        region: null,
        country: 'PT',
        isLocal: null,
        sessionCount: 0,
        lastSeenAt: '2026-10-19T00:00:00.000Z',
      },
    ]);
    expect(data[2]?.locations).toEqual([]);
  });
});
