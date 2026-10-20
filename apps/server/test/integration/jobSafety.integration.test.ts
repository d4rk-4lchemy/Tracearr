/**
 * jobSafety primitives against a real Redis: Redis-side dedup for addSingleton,
 * fail-closed checkpoints, attempt-free yields, crash recovery through stalled
 * detection, and the shutdown budget.
 *
 * Run with: pnpm --filter @tracearr/server test:integration jobSafety
 */

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it, expect, afterEach } from 'vitest';
import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_KEYS, getRedisPrefix } from '@tracearr/shared';
import {
  WORKER_DEFAULTS,
  addSingleton,
  checkpoint,
  yieldJob,
  registerWorker,
  shutdownAllJobs,
} from '../../src/jobs/jobSafety.js';
import { reconcileJobsOnBoot } from '../../src/jobs/jobsBoot.js';
import { DEFAULT_LOCK_DURATION_MS } from '../../src/jobs/lockUtils.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
const connection = { url: REDIS_URL };
const prefix = `${getRedisPrefix()}bull`;

const LOCK_DURATION_MS = 1500;
const STALLED_INTERVAL_MS = 300;
const SHORT_LOCK = {
  lockDuration: LOCK_DURATION_MS,
  stalledInterval: STALLED_INTERVAL_MS,
  maxStalledCount: 2,
} as const;

const queues: Queue[] = [];
const workers: Worker[] = [];

function newQueue<T>(name = `job-safety-${randomUUID()}`): Queue<T> {
  const queue = new Queue<T>(name, { connection, prefix });
  queues.push(queue);
  return queue;
}

function newWorker<T>(
  queue: Queue<T>,
  processor: Processor<T>,
  opts: Partial<WorkerOptions> = WORKER_DEFAULTS
): Worker<T> {
  const worker = new Worker<T>(queue.name, processor, { connection, prefix, ...opts });
  worker.on('error', () => {});
  workers.push(worker);
  return worker;
}

async function until(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close(true).catch(() => {})));
  for (const queue of queues.splice(0)) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

describe('addSingleton', () => {
  it('accepts one of twenty concurrent adds and drops the rest while the job waits', async () => {
    const queue = newQueue<{ n: number }>();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, n) => addSingleton(queue, 'job', { n }, 'key-a'))
    );

    const accepted = results.filter((r) => r.accepted);
    expect(accepted).toHaveLength(1);
    expect(new Set(results.map((r) => r.jobId))).toEqual(new Set([accepted[0]!.jobId]));
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it('drops an add while the key is active and accepts one after the job completes', async () => {
    const queue = newQueue<{ n: number }>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = newWorker(queue, async () => {
      await gate;
    });

    const active = once(worker, 'active');
    const first = await addSingleton(queue, 'job', { n: 1 }, 'key-b');
    await active;

    const second = await addSingleton(queue, 'job', { n: 2 }, 'key-b');
    expect(first.accepted).toBe(true);
    expect(second).toEqual({ jobId: first.jobId, accepted: false });

    const completed = once(worker, 'completed');
    release();
    await completed;

    const third = await addSingleton(queue, 'job', { n: 3 }, 'key-b');
    expect(third.accepted).toBe(true);
  });

  it('accepts an add right after obliterate even though a dedup key may remain', async () => {
    const queue = newQueue<{ n: number }>();
    const first = await addSingleton(queue, 'job', { n: 1 }, 'key-c');
    expect(first.accepted).toBe(true);

    await queue.obliterate({ force: true });
    // The leftover an interrupted removal can leave: a key pointing at a job hash that is gone.
    const client = await queue.getBackend().client;
    await client.set(`${queue.keys.de}:key-c`, first.jobId);
    expect(await queue.getDeduplicationJobId('key-c')).toBe(first.jobId);

    const second = await addSingleton(queue, 'job', { n: 2 }, 'key-c');
    expect(second.accepted).toBe(true);
    expect(await queue.getDeduplicationJobId('key-c')).toBe(second.jobId);
  });

  it('honors delay: a delayed add holds the key against a second add', async () => {
    const queue = newQueue<{ n: number }>();

    const delayed = await addSingleton(queue, 'job', { n: 1 }, 'key-d', { delay: 60_000 });
    const plain = await addSingleton(queue, 'job', { n: 2 }, 'key-d');

    expect(delayed.accepted).toBe(true);
    expect(plain).toEqual({ jobId: delayed.jobId, accepted: false });
    expect(await queue.getDelayedCount()).toBe(1);
  });
});

describe('checkpoint and yieldJob', () => {
  it('a processor that checkpoints then yields resumes from the checkpoint with attemptsMade unchanged', async () => {
    const queue = newQueue<{ step: number }>();
    let failed = false;
    const worker = newWorker(queue, async (job: Job<{ step: number }>, token?: string) => {
      if (job.data.step === 0) {
        await checkpoint(job, { step: 1 });
        await yieldJob(job, token, 0);
      }
      return job.data.step;
    });
    worker.on('failed', () => {
      failed = true;
    });

    const completed = once(worker, 'completed');
    const { jobId } = await addSingleton(queue, 'job', { step: 0 }, 'key-e');
    const [, returnvalue] = await completed;

    expect(returnvalue).toBe(1);
    expect((await queue.getJob(jobId))?.attemptsMade).toBe(1);
    expect(failed).toBe(false);
  });

  it('checkpoint throws when the lock is gone and leaves data untouched', async () => {
    const queue = newQueue<{ step: number }>();
    let checkpointError: Error | null = null;
    let checkpointSucceeded = false;

    const workerA = newWorker(
      queue,
      async (job: Job<{ step: number }>) => {
        await sleep(LOCK_DURATION_MS + 2 * STALLED_INTERVAL_MS + 500);
        try {
          await checkpoint(job, { step: 9 }, LOCK_DURATION_MS);
          checkpointSucceeded = true;
        } catch (err) {
          checkpointError = err as Error;
          throw err;
        }
      },
      // A negative renew time skips the lock manager's timer, so the lock really lapses.
      { ...SHORT_LOCK, lockRenewTime: -1 }
    );
    const workerB = newWorker(queue, async () => 'from-b', { ...SHORT_LOCK, autorun: false });

    const activeA = once(workerA, 'active');
    const { jobId } = await addSingleton(queue, 'job', { step: 0 }, 'key-f');
    await activeA;
    const completedB = once(workerB, 'completed');
    void workerB.run();
    await completedB;

    await until(
      () => checkpointError !== null || checkpointSucceeded,
      5000,
      "worker A's checkpoint"
    );
    expect(checkpointSucceeded).toBe(false);
    expect(checkpointError).toBeInstanceOf(Error);
    expect(String(checkpointError)).toMatch(/Lost lock/);
    expect((await queue.getJob(jobId))?.data.step).toBe(0);
  }, 20000);
});

describe('crash recovery', () => {
  it('a job whose worker died is back in wait within lockDuration + 2 * stalledInterval with its checkpoint intact', async () => {
    const queue = newQueue<{ cursor: string | null }>();
    let checkpointed = false;
    const workerA = newWorker(
      queue,
      async (job: Job<{ cursor: string | null }>) => {
        await checkpoint(job, { cursor: 'c1' }, LOCK_DURATION_MS);
        checkpointed = true;
        await new Promise(() => {});
      },
      SHORT_LOCK
    );
    let seenByB: string | null | undefined;
    const workerB = newWorker(
      queue,
      async (job: Job<{ cursor: string | null }>) => {
        seenByB = job.data.cursor;
      },
      { ...SHORT_LOCK, autorun: false }
    );

    await addSingleton(queue, 'job', { cursor: null }, 'key-g');
    await until(() => checkpointed, 5000, "worker A's checkpoint");
    const activeB = once(workerB, 'active');
    void workerB.run();

    const clientA = await workerA.getBackend().client;
    const crashTime = Date.now();
    clientA.disconnect();

    await Promise.race([
      activeB,
      sleep(LOCK_DURATION_MS + 3 * STALLED_INTERVAL_MS + 3000).then(() => {
        throw new Error('timed out waiting for worker B to reclaim the job');
      }),
    ]);
    const reclaimedMs = Date.now() - crashTime;

    expect(reclaimedMs).toBeLessThanOrEqual(LOCK_DURATION_MS + 2 * STALLED_INTERVAL_MS + 2500);
    await until(() => seenByB !== undefined, 5000, 'worker B to run the job');
    expect(seenByB).toBe('c1');
  }, 20000);
});

describe('shutdownAllJobs', () => {
  it('resolves under the budget and the aborted processor yields with a checkpoint', async () => {
    const queue = newQueue<{ i: number }>();
    const worker = newWorker(
      queue,
      async (job: Job<{ i: number }>, token?: string, signal?: AbortSignal) => {
        let i = job.data.i;
        for (;;) {
          if (signal?.aborted) {
            await checkpoint(job, { i });
            await yieldJob(job, token, 0);
          }
          await sleep(50);
          i++;
        }
      }
    );
    let closed = false;
    worker.on('closed', () => {
      closed = true;
    });
    registerWorker(worker);

    const active = once(worker, 'active');
    const { jobId } = await addSingleton(queue, 'job', { i: 0 }, 'key-h');
    await active;
    await sleep(200);

    const started = Date.now();
    await shutdownAllJobs(3000);

    expect(Date.now() - started).toBeLessThan(3000);
    const job = await queue.getJob(jobId);
    expect(await job?.getState()).toBe('delayed');
    expect(job?.data.i).toBeGreaterThan(0);
    expect(closed).toBe(true);
  });

  it('force-closes a processor that ignores the signal and still resolves under the budget', async () => {
    const queue = newQueue<{ n: number }>();
    const worker = newWorker(queue, (_job: Job<{ n: number }>) => new Promise<never>(() => {}));
    let closed = false;
    worker.on('closed', () => {
      closed = true;
    });
    registerWorker(worker);

    const active = once(worker, 'active');
    const { jobId } = await addSingleton(queue, 'job', { n: 1 }, 'key-i');
    await active;

    const started = Date.now();
    await shutdownAllJobs(3000);

    expect(Date.now() - started).toBeLessThan(3000);
    expect(closed).toBe(true);
    expect(await (await queue.getJob(jobId))?.getState()).toBe('active');
  });
});

describe('library-sync manual superseding (real queue, library-sync shape)', () => {
  type SyncData = { serverId: string; triggeredBy: 'manual' | 'scheduled' };

  async function removeQueuedAutomatic(queue: Queue<SyncData>, handles?: Job<SyncData>[]) {
    const queued = handles ?? (await queue.getJobs(['waiting', 'delayed']));
    for (const job of queued) {
      if (job.data.triggeredBy !== 'manual') await job.remove().catch(() => undefined);
    }
  }

  it('manual while a scheduled job waits: one manual job remains', async () => {
    const queue = newQueue<SyncData>();
    const auto = await addSingleton(
      queue,
      'auto-sync-s1',
      { serverId: 's1', triggeredBy: 'scheduled' },
      'sync-s1'
    );
    expect(auto.accepted).toBe(true);

    await removeQueuedAutomatic(queue);
    const manual = await addSingleton(
      queue,
      'manual-sync-s1',
      { serverId: 's1', triggeredBy: 'manual' },
      'sync-s1'
    );

    expect(manual.accepted).toBe(true);
    expect(await queue.getWaitingCount()).toBe(1);
    expect((await queue.getJob(manual.jobId))?.name).toBe('manual-sync-s1');
  });

  it('manual while the key is active: dropped, exactly one job', async () => {
    const queue = newQueue<SyncData>();
    await addSingleton(
      queue,
      'auto-sync-s1',
      { serverId: 's1', triggeredBy: 'scheduled' },
      'sync-s1'
    );
    // Read while still waiting, as enqueueLibrarySync would just before the worker takes it.
    const staleHandles = await queue.getJobs(['waiting', 'delayed']);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = newWorker(queue, async () => {
      await gate;
    });
    const active = once(worker, 'active');
    await active;

    await removeQueuedAutomatic(queue, staleHandles);
    const manual = await addSingleton(
      queue,
      'manual-sync-s1',
      { serverId: 's1', triggeredBy: 'manual' },
      'sync-s1'
    );

    expect(manual.accepted).toBe(false);
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
    expect(counts).toEqual({ active: 1, waiting: 0, delayed: 0 });
    release();
  });
});

describe('import-shaped processor yield', () => {
  it('a processor that checkpoints pages and yields on abort resumes at the checkpointed page', async () => {
    type ImportData = { checkpoint?: number };
    const queue = newQueue<ImportData>();
    const pages: Record<'a' | 'b', number[]> = { a: [], b: [] };
    const pager =
      (who: 'a' | 'b') => async (job: Job<ImportData>, token?: string, signal?: AbortSignal) => {
        for (let page = job.data.checkpoint ?? 0; page < 5; page++) {
          if (signal?.aborted) await yieldJob(job, token, 0);
          await checkpoint(job, { checkpoint: page + 1 }, LOCK_DURATION_MS);
          pages[who].push(page);
          await sleep(100);
        }
        return 'done';
      };

    const workerA = newWorker(queue, pager('a'), SHORT_LOCK);
    registerWorker(workerA);
    const job = await queue.add('tautulli-import', {});
    await until(() => pages.a.length >= 2, 5000, 'worker A to finish two pages');

    await shutdownAllJobs(3000);
    const parked = await queue.getJob(job.id!);
    expect(await parked?.getState()).toBe('delayed');
    const resumeAt = parked?.data.checkpoint;
    expect(resumeAt).toBe(pages.a.length);

    const workerB = newWorker(queue, pager('b'), SHORT_LOCK);
    const [, returnvalue] = await once(workerB, 'completed');

    expect(returnvalue).toBe('done');
    expect(pages.b[0]).toBe(resumeAt);
    expect([...pages.a, ...pages.b]).toEqual([0, 1, 2, 3, 4]);
    expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
  });
});

describe('shutdown sequence as index.ts runs it', () => {
  type SyncData = { completedLibraryIds?: string[] };
  const LIBRARIES = ['l0', 'l1', 'l2', 'l3'];

  function librarySync(seenAtStart: string[][]) {
    return async (job: Job<SyncData>, token?: string, signal?: AbortSignal) => {
      const completed = [...(job.data.completedLibraryIds ?? [])];
      seenAtStart.push([...completed]);
      for (const library of LIBRARIES) {
        if (completed.includes(library)) continue;
        if (signal?.aborted) await yieldJob(job, token, 0);
        try {
          await sleep(400, undefined, { signal });
        } catch {
          await yieldJob(job, token, 0);
        }
        completed.push(library);
        await checkpoint(job, { completedLibraryIds: completed });
      }
      return completed.length;
    };
  }

  it('cancel, graceful race, force close, then module close: exits under the budget with a delayed checkpointed job', async () => {
    const name = `job-safety-${randomUUID()}`;
    const queue = new Queue<SyncData>(name, { connection, prefix });
    const seen: string[][] = [];
    const worker = newWorker(queue, librarySync(seen));
    registerWorker(worker);

    const { jobId } = await addSingleton(queue, 'sync', {}, 'sync-s1');
    const deadline = Date.now() + 5000;
    while ((await queue.getJob(jobId))?.data.completedLibraryIds?.length !== 2) {
      if (Date.now() > deadline) throw new Error('timed out waiting for two libraries');
      await sleep(25);
    }

    const started = Date.now();
    await shutdownAllJobs(4000);
    await worker.close();
    await queue.close();
    expect(Date.now() - started).toBeLessThan(4000);

    const reopened = newQueue<SyncData>(name);
    const parked = await reopened.getJob(jobId);
    expect(await parked?.getState()).toBe('delayed');
    expect(parked?.data.completedLibraryIds).toEqual(['l0', 'l1']);

    const resumed: string[][] = [];
    const next = newWorker(reopened, librarySync(resumed));
    const [, returnvalue] = await once(next, 'completed');
    expect(returnvalue).toBe(4);
    expect(resumed[0]).toHaveLength(2);
  });
});

describe('reconcileJobsOnBoot against real queues', () => {
  const IMPORT_LOCK_MS = 5 * 60_000;
  const TWO_HOURS_MS = 2 * 60 * 60_000;
  const serverA = randomUUID();

  it('clears legacy noise once and leaves a waiting import and its lock untouched', async () => {
    const redis = new Redis(REDIS_URL);
    await redis.del(REDIS_KEYS.JOBS_SCHEMA);
    const bootPrefix = `${prefix}-${randomUUID()}`;
    const byName = new Map<string, Queue>();
    for (const name of [
      'library-sync',
      'image-precache',
      'maintenance',
      'imports',
      'version-check',
      'inactivity-check',
      'plex-token-refresh',
      'run-retention',
      'backup',
      'request-sync',
    ]) {
      const queue = new Queue(name, { connection, prefix: bootPrefix });
      queues.push(queue);
      byName.set(name, queue);
    }
    const queue = (name: string): Queue => byName.get(name)!;

    try {
      const librarySync = queue('library-sync');
      await librarySync.add(
        'boot-sync',
        { serverId: serverA },
        { jobId: `boot-sync-${serverA}-1` }
      );
      await librarySync.add(
        'boot-sync',
        { serverId: serverA },
        { jobId: `boot-sync-${serverA}-2` }
      );
      await librarySync.add(
        'event-sync',
        { serverId: serverA },
        { jobId: `event-sync-${serverA}-9` }
      );
      await librarySync.upsertJobScheduler(
        '5d41402abc4b2a76b9719d911017c592',
        { every: 60 * 60_000 },
        { name: 'auto-sync', data: { serverId: serverA } }
      );

      const imagePrecache = queue('image-precache');
      for (const cursor of ['start', 'item-50']) {
        await imagePrecache.add(
          'precache',
          { serverId: serverA, cursor: cursor === 'start' ? null : cursor },
          { jobId: `precache-${serverA}-${cursor}-1` }
        );
      }

      const maintenance = queue('maintenance');
      await maintenance.add(
        'm',
        { type: 'normalize_players' },
        { jobId: 'p-old', timestamp: 1000 }
      );
      await maintenance.add(
        'm',
        { type: 'normalize_players' },
        { jobId: 'p-new', timestamp: 2000 }
      );
      await maintenance.add(
        'm',
        { type: 'normalize_codecs' },
        { jobId: 'c-only', timestamp: 1500 }
      );

      const imports = queue('imports');
      const ghost = newWorker(imports, () => new Promise<never>(() => {}), {
        ...WORKER_DEFAULTS,
        prefix: bootPrefix,
      });
      const active = once(ghost, 'active');
      await imports.add('tautulli-import', {}, { jobId: 'import-running' });
      await active;
      const lockKey = `${imports.toKey('import-running')}:lock`;
      await redis.pexpire(lockKey, TWO_HOURS_MS);
      await ghost.close(true);
      await imports.add('tautulli-import', {}, { jobId: 'import-queued' });

      const versionCheck = queue('version-check');
      await versionCheck.add('check', { force: false }, { jobId: 'startup-check' });
      await versionCheck.upsertJobScheduler(
        'version-check-repeat',
        { every: 6 * 60 * 60_000 },
        {
          name: 'check',
          data: { force: false },
        }
      );

      const run = () =>
        reconcileJobsOnBoot({
          redis,
          queues: (name) => byName.get(name),
          listServerIds: async () => [serverA],
          enqueuePrecachePass: async (id) => {
            const { jobId, accepted } = await addSingleton(
              imagePrecache,
              'precache',
              { serverId: id, cursor: null },
              `precache-${id}`
            );
            return accepted ? jobId : undefined;
          },
          importLockMs: IMPORT_LOCK_MS,
          workerLockMs: DEFAULT_LOCK_DURATION_MS,
        });

      const snapshot = async () => ({
        librarySync: await librarySync.getJobCountByTypes(
          'waiting',
          'delayed',
          'active',
          'prioritized'
        ),
        librarySyncSchedulers: await librarySync.getJobSchedulersCount(),
        precache: (await imagePrecache.getJobs(['waiting', 'delayed', 'active'])).map((j) => j.id),
        maintenance: (await maintenance.getJobs(['waiting', 'delayed'])).map((j) => j.id).sort(),
        importsWaiting: (await imports.getJobs(['waiting'])).map((j) => j.id),
        importsActive: (await imports.getJobs(['active'])).map((j) => j.id),
        versionCheck: (await versionCheck.getJobs(['waiting', 'delayed'])).map((j) => ({
          id: j.id,
          scheduler: j.repeatJobKey,
        })),
        versionCheckSchedulers: await versionCheck.getJobSchedulersCount(),
      });

      expect(await run()).toEqual({ ran: true });

      const after = await snapshot();
      expect(after.librarySync).toBe(0);
      expect(after.librarySyncSchedulers).toBe(0);
      expect(after.precache).toHaveLength(1);
      expect(after.precache[0]).toMatch(new RegExp(`^precache-${serverA}-[0-9a-f-]{36}$`));
      expect(after.maintenance).toEqual(['c-only', 'p-old']);
      expect(after.importsWaiting).toEqual(['import-queued']);
      expect(after.importsActive).toEqual(['import-running']);
      const lockTtl = await redis.pttl(lockKey);
      expect(lockTtl).toBeGreaterThan(0);
      expect(lockTtl).toBeLessThanOrEqual(IMPORT_LOCK_MS);
      expect(after.versionCheck).toEqual([
        expect.objectContaining({ scheduler: 'version-check-repeat' }),
      ]);
      expect(after.versionCheckSchedulers).toBe(1);
      expect(await redis.get(REDIS_KEYS.JOBS_SCHEMA)).toBe('1');

      expect(await run()).toEqual({ ran: false });
      expect(await snapshot()).toEqual(after);
    } finally {
      await redis.del(REDIS_KEYS.JOBS_SCHEMA);
      redis.disconnect();
    }
  });
});
