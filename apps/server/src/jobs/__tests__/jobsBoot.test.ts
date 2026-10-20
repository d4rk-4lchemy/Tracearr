import { describe, it, expect, vi } from 'vitest';
import { REDIS_KEYS } from '@tracearr/shared';
import type { JobState, Queue } from 'bullmq';
import { reconcileJobsOnBoot, JOBS_SCHEMA_VERSION, type JobsBootDeps } from '../jobsBoot.js';

const IMPORT_LOCK_MS = 300_000;
const WORKER_LOCK_MS = 60_000;

interface FakeJobSpec {
  id: string;
  state: JobState;
  timestamp?: number;
  data?: Record<string, unknown>;
  repeatJobKey?: string;
}

function fakeQueue(name: string, specs: FakeJobSpec[] = []) {
  const jobs = specs.map((spec) => ({
    ...spec,
    data: spec.data ?? {},
    timestamp: spec.timestamp ?? 0,
    remove: vi.fn(async () => {}),
  }));
  return {
    name,
    jobs,
    obliterate: vi.fn(async () => {}),
    getJobs: vi.fn(async (types: JobState[]) => jobs.filter((job) => types.includes(job.state))),
    toKey: (id: string) => `bull:${name}:${id}`,
  };
}

type FakeQueue = ReturnType<typeof fakeQueue>;

const STARTUP_QUEUES = [
  'version-check',
  'inactivity-check',
  'plex-token-refresh',
  'run-retention',
  'backup',
  'request-sync',
];
const RECONCILED = ['library-sync', 'image-precache', 'maintenance', 'imports', ...STARTUP_QUEUES];

/** Every reconciled queue is registered unless `missing` names it; `queueList` replaces the empty defaults. */
function deps(
  queueList: FakeQueue[],
  overrides: Partial<JobsBootDeps> = {},
  missing: string[] = []
) {
  const calls: string[] = [];
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const byName = new Map(RECONCILED.map((name) => [name, fakeQueue(name)]));
  for (const queue of queueList) byName.set(queue.name, queue);
  for (const name of missing) byName.delete(name);
  for (const queue of byName.values()) {
    queue.obliterate.mockImplementation(async () => {
      calls.push(`obliterate:${queue.name}`);
    });
  }
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...flags: (string | number)[]) => {
      if (flags.includes('NX') && store.has(key)) return null;
      if (key === REDIS_KEYS.JOBS_SCHEMA) calls.push(`marker:${value}`);
      store.set(key, value);
      const px = flags.indexOf('PX');
      if (px !== -1) ttls.set(key, Number(flags[px + 1]));
      return 'OK' as const;
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      ttls.delete(key);
      return 1 as const;
    }),
    pttl: vi.fn(async (key: string) => ttls.get(key) ?? -2),
    pexpire: vi.fn(async (key: string, ms: number) => {
      ttls.set(key, ms);
      return 1 as const;
    }),
  };
  const built: JobsBootDeps = {
    redis: redis as unknown as JobsBootDeps['redis'],
    queues: vi.fn((name: string) => byName.get(name) as unknown as Queue | undefined),
    listServerIds: vi.fn(async () => ['s1', 's2']),
    enqueuePrecachePass: vi.fn(async (serverId: string) => {
      calls.push(`pass:${serverId}`);
      return `precache-${serverId}-x`;
    }),
    importLockMs: IMPORT_LOCK_MS,
    workerLockMs: WORKER_LOCK_MS,
    ...overrides,
  };
  return { deps: built, redis, store, ttls, calls };
}

describe('reconcileJobsOnBoot', () => {
  it('is a no-op when the marker is already set', async () => {
    const librarySync = fakeQueue('library-sync', [{ id: 'a', state: 'waiting' }]);
    const d = deps([librarySync]);
    d.store.set(REDIS_KEYS.JOBS_SCHEMA, JOBS_SCHEMA_VERSION);

    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: false });
    expect(d.deps.queues).not.toHaveBeenCalled();
    expect(librarySync.obliterate).not.toHaveBeenCalled();
    expect(d.redis.set).not.toHaveBeenCalled();
  });

  it('obliterates library-sync and image-precache and queues one precache pass per server', async () => {
    const d = deps([fakeQueue('library-sync'), fakeQueue('image-precache')]);

    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: true });
    expect(d.calls).toEqual([
      'obliterate:library-sync',
      'obliterate:image-precache',
      'pass:s1',
      'pass:s2',
      `marker:${JOBS_SCHEMA_VERSION}`,
    ]);
  });

  it('keeps the oldest waiting maintenance job per type and removes the rest', async () => {
    const maintenance = fakeQueue('maintenance', [
      { id: 'p-new', state: 'waiting', timestamp: 3, data: { type: 'normalize_players' } },
      { id: 'p-old', state: 'delayed', timestamp: 1, data: { type: 'normalize_players' } },
      { id: 'p-mid', state: 'prioritized', timestamp: 2, data: { type: 'normalize_players' } },
      { id: 'c', state: 'waiting', timestamp: 5, data: { type: 'normalize_codecs' } },
    ]);

    await reconcileJobsOnBoot(deps([maintenance]).deps);

    const removed = maintenance.jobs.filter((job) => job.remove.mock.calls.length > 0);
    expect(removed.map((job) => job.id).sort()).toEqual(['p-mid', 'p-new']);
  });

  it('caps the lock TTL of active import and maintenance jobs and leaves waiting imports alone', async () => {
    const imports = fakeQueue('imports', [
      { id: 'running', state: 'active' },
      { id: 'queued', state: 'waiting' },
    ]);
    const maintenance = fakeQueue('maintenance', [
      { id: 'long', state: 'active', data: { type: 'normalize_players' } },
      { id: 'short', state: 'active', data: { type: 'normalize_codecs' } },
    ]);
    const d = deps([imports, maintenance]);
    d.ttls.set('bull:imports:running:lock', 7_000_000);
    d.ttls.set('bull:imports:queued:lock', 7_000_000);
    d.ttls.set('bull:maintenance:long:lock', 300_000);
    d.ttls.set('bull:maintenance:short:lock', 10_000);

    await reconcileJobsOnBoot(d.deps);

    expect(d.redis.pexpire.mock.calls).toEqual(
      expect.arrayContaining([
        ['bull:imports:running:lock', IMPORT_LOCK_MS],
        ['bull:maintenance:long:lock', WORKER_LOCK_MS],
      ])
    );
    expect(d.redis.pexpire).toHaveBeenCalledTimes(2);
    expect(imports.jobs.every((job) => job.remove.mock.calls.length === 0)).toBe(true);
  });

  it('removes non-scheduler waiting and delayed jobs from version-check, inactivity-check, plex-token-refresh, run-retention, backup and request-sync', async () => {
    const queues = STARTUP_QUEUES.map((name) =>
      fakeQueue(name, [
        { id: 'startup', state: 'waiting' },
        { id: 'retry', state: 'delayed' },
        { id: 'tick', state: 'delayed', repeatJobKey: 'sched' },
      ])
    );

    await reconcileJobsOnBoot(deps(queues).deps);

    for (const queue of queues) {
      const [startup, retry, tick] = queue.jobs;
      expect(startup?.remove, queue.name).toHaveBeenCalled();
      expect(retry?.remove, queue.name).toHaveBeenCalled();
      expect(tick?.remove, queue.name).not.toHaveBeenCalled();
    }
  });

  it('does not touch notifications-v2, notifications-v2-dlq, imports-dlq, kill-stream or the newsletter queues', async () => {
    const untouched = [
      'notifications-v2',
      'notifications-v2-dlq',
      'imports-dlq',
      'kill-stream',
      'newsletters',
      'newsletter-deliveries',
      'newsletter-deliveries-dlq',
    ].map((name) => fakeQueue(name, [{ id: 'j', state: 'waiting' }]));
    const d = deps(untouched);

    await reconcileJobsOnBoot(d.deps);

    for (const queue of untouched) {
      expect(d.deps.queues).not.toHaveBeenCalledWith(queue.name);
      expect(queue.getJobs).not.toHaveBeenCalled();
      expect(queue.obliterate).not.toHaveBeenCalled();
    }
  });

  it('sets the marker only after every queue succeeded', async () => {
    const backup = fakeQueue('backup');
    backup.getJobs.mockRejectedValue(new Error('redis down'));
    const d = deps([fakeQueue('library-sync'), backup]);

    await expect(reconcileJobsOnBoot(d.deps)).rejects.toThrow('redis down');
    expect(d.store.has(REDIS_KEYS.JOBS_SCHEMA)).toBe(false);
    expect(d.store.has(REDIS_KEYS.JOBS_SCHEMA)).toBe(false);
  });

  it('replaces a marker from an older schema version', async () => {
    const d = deps([]);
    d.store.set(REDIS_KEYS.JOBS_SCHEMA, '0');

    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: true });
    expect(d.store.get(REDIS_KEYS.JOBS_SCHEMA)).toBe(JOBS_SCHEMA_VERSION);
  });

  it('leaves the marker unset when a queue was not registered, so the next boot retries', async () => {
    const d = deps([], {}, ['backup']);

    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: true });
    expect(d.store.has(REDIS_KEYS.JOBS_SCHEMA)).toBe(false);
  });

  it('waits for the instance holding the lock and touches nothing itself', async () => {
    vi.useFakeTimers();
    const librarySync = fakeQueue('library-sync');
    const d = deps([librarySync]);
    d.store.set(`${REDIS_KEYS.JOBS_SCHEMA}:lock`, '1');
    d.redis.pttl.mockResolvedValueOnce(400).mockResolvedValueOnce(-2);

    const result = reconcileJobsOnBoot(d.deps);
    await vi.advanceTimersByTimeAsync(500);

    expect(await result).toEqual({ ran: false });
    expect(librarySync.obliterate).not.toHaveBeenCalled();
    expect(d.store.has(REDIS_KEYS.JOBS_SCHEMA)).toBe(false);
    vi.useRealTimers();
  });

  it('releases the lock once reconciliation is done', async () => {
    const d = deps([]);
    await reconcileJobsOnBoot(d.deps);
    expect(d.store.has(`${REDIS_KEYS.JOBS_SCHEMA}:lock`)).toBe(false);
  });

  it('a second boot after the marker is set does nothing', async () => {
    const librarySync = fakeQueue('library-sync');
    const d = deps([librarySync]);

    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: true });
    expect(await reconcileJobsOnBoot(d.deps)).toEqual({ ran: false });
    expect(librarySync.obliterate).toHaveBeenCalledTimes(1);
    expect(d.store.get(REDIS_KEYS.JOBS_SCHEMA)).toBe(JOBS_SCHEMA_VERSION);
  });
});
