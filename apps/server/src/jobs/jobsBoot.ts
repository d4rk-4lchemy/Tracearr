/**
 * One-time cleanup of what releases before 2.9 left in Redis: chained and
 * duplicated library-sync and image-precache jobs without a dedup key, stacked
 * maintenance and startup jobs, and ghost active jobs holding hour-long locks.
 * Runs after every queue is initialized and before any worker starts.
 */

import { REDIS_KEYS } from '@tracearr/shared';
import type { Job, JobType, Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const JOBS_SCHEMA_VERSION = '1';

export interface JobsBootDeps {
  redis: Pick<Redis, 'get' | 'set' | 'del' | 'pttl' | 'pexpire'>;
  queues: (name: string) => Queue | undefined;
  listServerIds: () => Promise<string[]>;
  enqueuePrecachePass: (serverId: string) => Promise<string | undefined>;
  importLockMs: number;
  workerLockMs: number;
}

const PENDING: JobType[] = ['waiting', 'delayed', 'prioritized'];
const LOCK_MS = 5 * 60 * 1000;
const LOCK_POLL_MS = 500;

const STARTUP_QUEUES = [
  'version-check',
  'inactivity-check',
  'plex-token-refresh',
  'run-retention',
  'backup',
  'request-sync',
];

export async function reconcileJobsOnBoot(deps: JobsBootDeps): Promise<{ ran: boolean }> {
  // Work first, marker last: a crash mid-way reruns it on the next boot, which every step tolerates.
  const marker = REDIS_KEYS.JOBS_SCHEMA;
  if ((await deps.redis.get(marker)) === JOBS_SCHEMA_VERSION) return { ran: false };

  // One instance reconciles; the others wait for it so their queued boot work is not wiped.
  const lock = `${marker}:lock`;
  if ((await deps.redis.set(lock, '1', 'PX', LOCK_MS, 'NX')) !== 'OK') {
    console.log('[JobsBoot] another instance is reconciling, waiting');
    while ((await deps.redis.pttl(lock)) > 0) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    return { ran: false };
  }
  try {
    return await reconcile(deps);
  } finally {
    await deps.redis.del(lock);
  }
}

async function reconcile(deps: JobsBootDeps): Promise<{ ran: boolean }> {
  const marker = REDIS_KEYS.JOBS_SCHEMA;
  let skipped = 0;
  const queue = (name: string): Queue | undefined => {
    const found = deps.queues(name);
    if (!found) {
      skipped++;
      console.log(`[JobsBoot] ${name}: not registered, skipped`);
    }
    return found;
  };

  const capLocks = async (q: Queue, capMs: number): Promise<number> => {
    let capped = 0;
    for (const job of await q.getJobs(['active'])) {
      if (!job.id) continue;
      const key = `${q.toKey(job.id)}:lock`;
      if ((await deps.redis.pttl(key)) > capMs) {
        await deps.redis.pexpire(key, capMs);
        capped++;
      }
    }
    return capped;
  };

  const removeAll = async (jobs: Job[]): Promise<number> => {
    for (const job of jobs) await job.remove().catch(() => undefined);
    return jobs.length;
  };

  const librarySync = queue('library-sync');
  if (librarySync) {
    await librarySync.obliterate({ force: true });
    console.log('[JobsBoot] library-sync: emptied');
  }

  const imagePrecache = queue('image-precache');
  if (imagePrecache) {
    await imagePrecache.obliterate({ force: true });
    let passes = 0;
    for (const id of await deps.listServerIds()) {
      if (await deps.enqueuePrecachePass(id)) passes++;
    }
    console.log(`[JobsBoot] image-precache: emptied, ${passes} passes queued`);
  }

  const maintenance = queue('maintenance');
  if (maintenance) {
    const byType = new Map<string, Job[]>();
    for (const job of await maintenance.getJobs(PENDING)) {
      const type = String((job.data as { type?: unknown }).type);
      byType.set(type, [...(byType.get(type) ?? []), job]);
    }
    let removed = 0;
    for (const jobs of byType.values()) {
      jobs.sort((a, b) => a.timestamp - b.timestamp);
      removed += await removeAll(jobs.slice(1));
    }
    const capped = await capLocks(maintenance, deps.workerLockMs);
    console.log(`[JobsBoot] maintenance: ${removed} duplicates removed, ${capped} locks capped`);
  }

  const imports = queue('imports');
  if (imports) {
    const capped = await capLocks(imports, deps.importLockMs);
    console.log(`[JobsBoot] imports: ${capped} locks capped`);
  }

  for (const name of STARTUP_QUEUES) {
    const q = queue(name);
    if (!q) continue;
    const stale = (await q.getJobs(PENDING)).filter((job) => !job.repeatJobKey);
    console.log(`[JobsBoot] ${name}: ${await removeAll(stale)} queued jobs removed`);
  }

  if (skipped > 0) {
    console.log(`[JobsBoot] ${skipped} queues skipped; the next boot runs reconciliation again`);
    return { ran: true };
  }
  await deps.redis.set(marker, JOBS_SCHEMA_VERSION);
  console.log('[JobsBoot] reconciliation complete');
  return { ran: true };
}
