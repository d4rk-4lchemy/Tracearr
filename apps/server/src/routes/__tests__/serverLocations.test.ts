import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@tracearr/shared';

vi.mock('../../services/serverLocations.js', () => ({
  getServerLocations: vi.fn(),
  replaceServerLocations: vi.fn(),
}));
vi.mock('../../jobs/maintenanceQueue.js', () => ({
  enqueueServerLocationSyncIfBehind: vi.fn(),
}));

import { getServerLocations, replaceServerLocations } from '../../services/serverLocations.js';
import { enqueueServerLocationSyncIfBehind } from '../../jobs/maintenanceQueue.js';
import { serverLocationRoutes } from '../serverLocations.js';

const owner: AuthUser = { userId: randomUUID(), username: 'admin', role: 'owner', serverIds: [] };
const viewer: AuthUser = {
  userId: randomUUID(),
  username: 'viewer',
  role: 'viewer',
  serverIds: [],
};
const serverId = randomUUID();
const chicago = {
  effectiveFrom: null,
  lat: 41.8781,
  lon: -87.6298,
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
};

let app: FastifyInstance;

async function build(user: AuthUser) {
  app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: unknown) => {
    (request as { user: AuthUser }).user = user;
  });
  await app.register(serverLocationRoutes, { prefix: '/servers' });
}

const put = (entries: unknown[]) =>
  app.inject({ method: 'PUT', url: `/servers/${serverId}/locations`, payload: { entries } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerLocations).mockResolvedValue({ entries: [], syncPending: false });
  vi.mocked(enqueueServerLocationSyncIfBehind).mockResolvedValue(true);
});

afterEach(async () => {
  await app.close();
});

describe('server location routes', () => {
  it('is owner-only', async () => {
    await build(viewer);
    expect((await put([chicago])).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/servers/${serverId}/locations` })).statusCode
    ).toBe(403);
  });

  it('rejects out-of-range coordinates', async () => {
    await build(owner);
    expect((await put([{ ...chicago, lat: 91 }])).statusCode).toBe(400);
  });

  it('rejects two undated entries', async () => {
    await build(owner);
    expect((await put([chicago, { ...chicago, city: 'Evanston' }])).statusCode).toBe(400);
  });

  it('rejects a country code that does not exist', async () => {
    await build(owner);
    expect((await put([{ ...chicago, country: 'XX' }])).statusCode).toBe(400);
  });

  it('404s for an unknown server', async () => {
    await build(owner);
    vi.mocked(getServerLocations).mockResolvedValue(null);
    expect((await put([chicago])).statusCode).toBe(404);
  });

  it('saves, blanks empty text to null, and queues the sync', async () => {
    await build(owner);
    const response = await put([{ ...chicago, region: '  ' }]);
    expect(response.statusCode).toBe(200);
    expect(replaceServerLocations).toHaveBeenCalledWith(serverId, [{ ...chicago, region: null }]);
    expect(enqueueServerLocationSyncIfBehind).toHaveBeenCalled();
    expect(JSON.parse(response.body).syncQueued).toBe(true);
  });

  it('still saves when queueing the sync fails', async () => {
    await build(owner);
    vi.mocked(enqueueServerLocationSyncIfBehind).mockRejectedValue(new Error('redis down'));
    const response = await put([chicago]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).syncQueued).toBe(false);
  });
});
