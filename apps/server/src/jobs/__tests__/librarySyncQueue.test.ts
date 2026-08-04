import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../serverState.js', () => ({
  isMaintenance: vi.fn().mockReturnValue(false),
}));

vi.mock('../../db/client.js', () => ({
  db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }) },
}));

vi.mock('../../services/librarySync.js', () => ({
  librarySyncService: { syncServer: vi.fn() },
  initLibrarySyncRedis: vi.fn(),
}));

const mockRedisScan = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisQuit = vi.fn();

vi.mock('../../services/cache.js', () => ({
  getPubSubService: vi.fn().mockReturnValue(null),
}));

vi.mock('../maintenanceQueue.js', () => ({
  enqueueMaintenanceJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../imagePrecacheQueue.js', () => ({
  enqueueImagePrecache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../precachePassPolicy.js', () => ({
  resolvePrecachePass: vi.fn().mockResolvedValue(null),
}));

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueGetJobs = vi.fn().mockResolvedValue([]);
const mockQueueClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function MockQueue() {
    return {
      add: mockQueueAdd,
      getJobs: mockQueueGetJobs,
      close: mockQueueClose,
      on: vi.fn(),
    };
  }),
  Worker: vi.fn().mockImplementation(function MockWorker() {
    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function MockRedis() {
    return { quit: mockRedisQuit, scan: mockRedisScan, del: mockRedisDel };
  }),
}));

import { Worker } from 'bullmq';
import { librarySyncService } from '../../services/librarySync.js';
import type { SyncResult } from '../../services/librarySync.js';
import {
  initLibrarySyncQueue,
  enqueueLibrarySyncFromEvent,
  shutdownLibrarySyncQueue,
  startLibrarySyncWorker,
  invalidateLibraryCaches,
} from '../librarySyncQueue.js';

describe('enqueueLibrarySyncFromEvent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });
    mockQueueGetJobs.mockResolvedValue([]);
    await shutdownLibrarySyncQueue();
    initLibrarySyncQueue('redis://localhost:6379');
  });

  it('does nothing when the queue has not been initialized', async () => {
    await shutdownLibrarySyncQueue();
    await enqueueLibrarySyncFromEvent('srv-1');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('enqueues a scheduled-triggered sync (not manual, to keep the incremental path eligible)', async () => {
    await enqueueLibrarySyncFromEvent('srv-1');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'event-sync-srv-1',
      { serverId: 'srv-1', triggeredBy: 'scheduled' },
      expect.objectContaining({ jobId: expect.stringMatching(/^event-sync-srv-1-\d+$/) })
    );
  });

  it('skips enqueueing when a sync is already active for the server', async () => {
    mockQueueGetJobs.mockResolvedValue([{ data: { serverId: 'srv-1' } }]);

    await enqueueLibrarySyncFromEvent('srv-1');

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('does not skip other servers active jobs', async () => {
    mockQueueGetJobs.mockResolvedValue([{ data: { serverId: 'srv-other' } }]);

    await enqueueLibrarySyncFromEvent('srv-1');

    expect(mockQueueAdd).toHaveBeenCalled();
  });
});

function fakeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    serverId: 'srv-1',
    libraryId: 'lib-1',
    libraryName: 'Movies',
    itemsProcessed: 0,
    itemsAdded: 0,
    itemsRemoved: 0,
    itemsSkipped: 0,
    snapshotId: null,
    ...overrides,
  };
}

describe('library sync worker - cache invalidation gating', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisScan.mockResolvedValue(['0', []]);
    mockRedisDel.mockResolvedValue(0);
    await shutdownLibrarySyncQueue();
    initLibrarySyncQueue('redis://localhost:6379');
  });

  /** Starts the worker, captures the processor bullmq's Worker mock was
   * constructed with, and runs it once against a fake job. */
  async function runSyncJob(results: SyncResult[]): Promise<void> {
    vi.mocked(librarySyncService.syncServer).mockResolvedValue(results);
    startLibrarySyncWorker();
    const processor = vi.mocked(Worker).mock.calls[0]![1] as (job: unknown) => Promise<unknown>;
    await processor({
      id: 'job-1',
      data: { serverId: 'srv-1', triggeredBy: 'scheduled' },
      updateProgress: vi.fn(),
    });
  }

  it('skips cache invalidation when the sync processed nothing', async () => {
    await runSyncJob([fakeSyncResult({ itemsProcessed: 0 })]);
    expect(mockRedisScan).not.toHaveBeenCalled();
  });

  it('invalidates the cache when the sync processed items', async () => {
    await runSyncJob([fakeSyncResult({ itemsProcessed: 5, itemsAdded: 5 })]);
    expect(mockRedisScan).toHaveBeenCalled();
  });

  it('invalidates the cache when a full scan tombstoned everything (itemsProcessed 0, itemsRemoved > 0)', async () => {
    await runSyncJob([fakeSyncResult({ itemsProcessed: 0, itemsRemoved: 5 })]);
    expect(mockRedisScan).toHaveBeenCalled();
  });

  it('invalidates the cache when orphan cleanup removed items (surfaced as a synthetic result)', async () => {
    await runSyncJob([
      fakeSyncResult({ itemsProcessed: 0, itemsRemoved: 0 }),
      fakeSyncResult({
        libraryId: 'orphan-cleanup',
        libraryName: 'Orphaned libraries cleanup',
        itemsRemoved: 3,
      }),
    ]);
    expect(mockRedisScan).toHaveBeenCalled();
  });
});

describe('invalidateLibraryCaches - collapsed single-cursor scan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await shutdownLibrarySyncQueue();
    initLibrarySyncQueue('redis://localhost:6379');
  });

  it('walks the shared library cache namespace once and only deletes keys matching a target prefix', async () => {
    mockRedisScan
      .mockResolvedValueOnce([
        '0',
        [
          'tracearr:library:stats:v2:server-1',
          'tracearr:library:sync:last:server-1:lib-1', // sync state - must survive
          'tracearr:library:media-detail:v2:abc',
          'tracearr:library:precache:watermark:server-1', // precache state - must survive
        ],
      ])
      .mockResolvedValueOnce(['0', []]); // public media-stats namespace sweep
    mockRedisDel.mockResolvedValue(0);

    await invalidateLibraryCaches('server-1');

    expect(mockRedisScan).toHaveBeenCalledTimes(2);
    expect(mockRedisScan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'tracearr:library:*',
      'COUNT',
      500
    );
    expect(mockRedisScan).toHaveBeenNthCalledWith(
      2,
      '0',
      'MATCH',
      'tracearr:public:media-stats:*',
      'COUNT',
      500
    );
    expect(mockRedisDel).toHaveBeenCalledWith(
      'tracearr:library:stats:v2:server-1',
      'tracearr:library:media-detail:v2:abc'
    );
  });

  it('walks multiple cursor pages but issues only one delete for all matched keys', async () => {
    mockRedisScan
      .mockResolvedValueOnce(['17', ['tracearr:library:stats:v2:server-1']])
      .mockResolvedValueOnce(['0', ['tracearr:library:genres:server-1']])
      .mockResolvedValueOnce(['0', ['tracearr:public:media-stats:libraries']]);
    mockRedisDel.mockResolvedValue(0);

    await invalidateLibraryCaches('server-1');

    expect(mockRedisScan).toHaveBeenCalledTimes(3);
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith(
      'tracearr:library:stats:v2:server-1',
      'tracearr:library:genres:server-1',
      'tracearr:public:media-stats:libraries'
    );
  });

  it('does nothing when no matching keys are found', async () => {
    mockRedisScan.mockResolvedValueOnce(['0', []]).mockResolvedValueOnce(['0', []]);

    await invalidateLibraryCaches('server-1');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
