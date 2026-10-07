/**
 * GET /api/v2/public/servers
 *
 * The server list comes from a mocked select and the connection and health
 * keys from a mocked cache, so each status branch is exercised by hand: a
 * server on a live connection, one the poller marked down with a reason, one
 * never checked, and a historical one that must not read the cache at all.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import { queryChain } from '../../test/helpers.js';
import type { ServerConnectionStatus, SSEConnectionState } from '@tracearr/shared';

const { mockCache, connectionStates, healthKeys } = vi.hoisted(() => {
  const connectionStates = new Map<string, SSEConnectionState>();
  const healthKeys = new Map<string, 'true' | 'false' | 'unauthorized'>();
  return {
    connectionStates,
    healthKeys,
    mockCache: {
      getAllActiveSessions: vi.fn(async () => [] as { serverId: string }[]),
      getServerConnectionStatus: vi.fn(async (id: string) => {
        const state = connectionStates.get(id);
        return state ? ({ serverId: id, state } as ServerConnectionStatus) : null;
      }),
      getServerHealth: vi.fn(async (id: string) => {
        const value = healthKeys.get(id);
        return value === undefined ? null : value === 'true';
      }),
      getServerDownReason: vi.fn(async (id: string) =>
        healthKeys.get(id) === 'unauthorized' ? 'unauthorized' : null
      ),
    },
  };
});

vi.mock('../../db/client.js', () => ({ db: { select: vi.fn(), execute: vi.fn() } }));
vi.mock('../../services/settings.js', () => ({ getSetting: vi.fn(() => Promise.resolve(240)) }));
vi.mock('../../services/cache.js', () => ({ getCacheService: () => mockCache }));
vi.mock('../../utils/buildInfo.js', () => ({ getCurrentVersion: () => '2.7.0' }));

import { db } from '../../db/client.js';
import { publicV2Routes } from '../publicV2/index.js';
import { translateChannelMessage } from '../publicV2/eventsTranslate.js';
import { resetPublicApiRateLimitCache } from '../publicV2/rateLimitCache.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticatePublicApi', async (request: FastifyRequest, _reply: FastifyReply) => {
    request.publicApiContext = { userId: 'u1' };
  });
  await app.register(publicV2Routes, { prefix: '/api/v2/public' });
  return app;
}

describe('GET /api/v2/public/servers', () => {
  let app: FastifyInstance;
  const up = randomUUID();
  const down = randomUUID();
  const fresh = randomUUID();
  const old = randomUUID();

  async function rowFor(id: string) {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/servers' });
    expect(res.statusCode).toBe(200);
    const row = res.json<{ data: { server_id: string }[] }>().data.find((r) => r.server_id === id);
    if (!row) throw new Error(`no row for ${id}`);
    return row;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    connectionStates.clear();
    healthKeys.clear();
    resetPublicApiRateLimitCache();
    vi.mocked(db.select).mockReturnValue(
      queryChain(vi.fn, [
        { id: up, name: 'Attic', type: 'plex', version: '1.41.0', historicalAt: null },
        { id: down, name: 'Garage', type: 'jellyfin', version: null, historicalAt: null },
        { id: fresh, name: 'New', type: 'emby', version: null, historicalAt: null },
        {
          id: old,
          name: 'Old Plex',
          type: 'plex',
          version: '1.32.0',
          historicalAt: new Date('2026-09-01T00:00:00Z'),
        },
      ])
    );
    mockCache.getAllActiveSessions.mockResolvedValue([{ serverId: up }, { serverId: up }]);
    connectionStates.set(up, 'connected');
    connectionStates.set(down, 'reconnecting');
    healthKeys.set(down, 'unauthorized');
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports a live connection as up, a rejected credential as down, an unchecked server and a historical one as unknown', async () => {
    app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v2/public/servers' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [
        {
          server_id: up,
          server_name: 'Attic',
          status: 'up',
          reason: null,
          server_type: 'plex',
          historical: false,
          active_streams: 2,
          version: '1.41.0',
        },
        {
          server_id: down,
          server_name: 'Garage',
          status: 'down',
          reason: 'unauthorized',
          server_type: 'jellyfin',
          historical: false,
          active_streams: 0,
          version: null,
        },
        {
          server_id: fresh,
          server_name: 'New',
          status: 'unknown',
          reason: null,
          server_type: 'emby',
          historical: false,
          active_streams: 0,
          version: null,
        },
        {
          server_id: old,
          server_name: 'Old Plex',
          status: 'unknown',
          reason: null,
          server_type: 'plex',
          historical: true,
          active_streams: 0,
          version: '1.32.0',
        },
      ],
      tracearr_version: '2.7.0',
    });
    expect(mockCache.getServerHealth).not.toHaveBeenCalledWith(up);
    expect(mockCache.getServerDownReason).toHaveBeenCalledTimes(1);
  });

  it('is up on a live connection with no health key, since a connected server is never polled', async () => {
    expect(await rowFor(up)).toMatchObject({ status: 'up', reason: null });
  });

  it('is up on a live connection even when a stale down key from before the reconnect remains', async () => {
    healthKeys.set(up, 'false');

    expect(await rowFor(up)).toMatchObject({ status: 'up', reason: null });
  });

  it('is down once the connection has fallen back and the poller has confirmed the server unreachable', async () => {
    connectionStates.set(down, 'fallback');
    healthKeys.set(down, 'false');

    expect(await rowFor(down)).toMatchObject({ status: 'down', reason: null });
  });

  it('is up without a live connection while polling still reaches the server', async () => {
    connectionStates.set(down, 'unsupported');
    healthKeys.set(down, 'true');

    expect(await rowFor(down)).toMatchObject({ status: 'up', reason: null });
  });

  it('keeps a historical server unknown and reads neither its connection nor its health', async () => {
    connectionStates.set(old, 'connected');
    healthKeys.set(old, 'true');

    expect(await rowFor(old)).toMatchObject({ status: 'unknown', reason: null, historical: true });
    expect(mockCache.getServerConnectionStatus).not.toHaveBeenCalledWith(old);
    expect(mockCache.getServerHealth).not.toHaveBeenCalledWith(old);
  });

  it.each(['connected', 'unsupported'] as const)(
    'includes Dispatcharr with a %s connection and its active stream count',
    async (state) => {
      vi.mocked(db.select).mockReturnValue(
        queryChain(vi.fn, [
          { id: up, name: 'Dispatcharr', type: 'dispatcharr', version: null, historicalAt: null },
        ])
      );
      connectionStates.set(up, state);
      healthKeys.set(up, 'true');
      expect(await rowFor(up)).toMatchObject({
        server_type: 'dispatcharr',
        status: 'up',
        active_streams: 2,
      });
      if (state === 'connected') expect(mockCache.getServerHealth).not.toHaveBeenCalledWith(up);
      else expect(mockCache.getServerHealth).toHaveBeenCalledWith(up);
    }
  );

  it('leads every row with exactly the keys of a server.health payload, in its order', async () => {
    const event = translateChannelMessage({
      event: 'server:down',
      at: '2026-10-06T10:30:00.000Z',
      data: { serverId: down, serverName: 'Garage', reason: 'unauthorized' },
    });
    if (event?.kind !== 'events') throw new Error('expected events');
    const eventKeys = Object.keys(event.events[0]?.data as Record<string, unknown>);

    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/servers' });
    const rows = res.json<{ data: Record<string, unknown>[] }>().data;
    for (const row of rows) {
      expect(Object.keys(row).slice(0, eventKeys.length)).toEqual(eventKeys);
    }
    const garage = rows.find((r) => r.server_id === down);
    expect(garage).toMatchObject(event.events[0]?.data as Record<string, unknown>);
  });
});
