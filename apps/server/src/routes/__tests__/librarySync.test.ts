import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';

vi.mock('../../db/client.js', () => ({ db: { select: vi.fn() } }));
vi.mock('../../jobs/librarySyncQueue.js', () => ({
  enqueueLibrarySync: vi.fn().mockResolvedValue('job-1'),
  getLibrarySyncStatus: vi.fn(),
}));
vi.mock('../library/index.js', () => ({ libraryStatsRoutes: async () => {} }));

import { db } from '../../db/client.js';
import { enqueueLibrarySync } from '../../jobs/librarySyncQueue.js';
import { libraryRoutes } from '../library.js';

function mockServerRow(row: { historicalAt: Date | null }) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([row]),
  } as never);
}

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: unknown }) => {
    request.user = { userId: randomUUID(), role: 'owner', serverIds: [] };
  });
  await app.register(libraryRoutes);
  return app;
}

describe('POST /sync/:serverId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    vi.mocked(enqueueLibrarySync).mockClear();
  });

  it('returns 409 and queues nothing for a historical server', async () => {
    mockServerRow({ historicalAt: new Date('2026-09-01T00:00:00Z') });
    app = await build();

    const response = await app.inject({ method: 'POST', url: `/sync/${randomUUID()}` });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('Resume this server to sync it');
    expect(enqueueLibrarySync).not.toHaveBeenCalled();
  });

  it('queues a sync for a live server', async () => {
    mockServerRow({ historicalAt: null });
    app = await build();

    const response = await app.inject({ method: 'POST', url: `/sync/${randomUUID()}` });

    expect(response.statusCode).toBe(200);
    expect(enqueueLibrarySync).toHaveBeenCalledTimes(1);
  });
});
