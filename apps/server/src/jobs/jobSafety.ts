/**
 * Shared BullMQ safety primitives: one job per logical key across restarts,
 * checkpoints behind a fail-closed lock check, attempt-free yields, and one
 * shutdown path for every registered worker.
 */

import { randomUUID } from 'node:crypto';
import {
  DelayedError,
  type Job,
  type JobsOptions,
  type Queue,
  type Worker,
  type WorkerOptions,
} from 'bullmq';
import { DEFAULT_LOCK_DURATION_MS, extendJobLock } from './lockUtils.js';

export const WORKER_DEFAULTS = {
  lockDuration: DEFAULT_LOCK_DURATION_MS,
  stalledInterval: 30_000,
  // BullMQ never resets a job's stall count, so this caps interrupted restarts over the job's whole life.
  maxStalledCount: 5,
} as const satisfies Partial<WorkerOptions>;

const workers = new Set<Worker>();
const queues = new Map<string, Queue>();

export function registerWorker(worker: Worker): void {
  workers.add(worker);
  worker.once('closed', () => workers.delete(worker));
}

export function registerQueue(queue: Queue): void {
  queues.set(queue.name, queue);
}

export function registeredQueue(name: string): Queue | undefined {
  return queues.get(name);
}

export function registeredQueues(): Queue[] {
  return [...queues.values()];
}

/**
 * Add a job unless one for `key` is already waiting, delayed or active. The check is
 * BullMQ's Redis-side deduplication, so it holds across processes and in the same tick.
 * `key` must not contain ':' (BullMQ rejects such custom job ids).
 */
export async function addSingleton<T>(
  queue: Queue<T>,
  name: string,
  data: T,
  key: string,
  opts?: Pick<JobsOptions, 'delay' | 'attempts'>
): Promise<{ jobId: string; accepted: boolean }> {
  const requestedId = `${key}-${randomUUID()}`;
  // Queue<T> types its job names as a conditional on T that stays unresolved here.
  const job = await (queue as Queue).add(name, data, {
    ...opts,
    jobId: requestedId,
    deduplication: { id: key },
  });
  return { jobId: job.id ?? requestedId, accepted: job.id === requestedId };
}

/**
 * Persist progress into job.data. The lock is extended first because updateData
 * never checks it: a job that lost its lock must throw here, before it can write
 * over its replacement's progress. `lockMs` must equal the calling worker's
 * lockDuration; a shorter value can let a long-lock worker's lock lapse before its
 * next renewal, a longer one delays crash recovery.
 */
export async function checkpoint<T>(
  job: Job<T>,
  patch: Partial<T>,
  lockMs: number = WORKER_DEFAULTS.lockDuration
): Promise<void> {
  await extendJobLock(job, lockMs);
  await job.updateData({ ...job.data, ...patch });
}

/** Hand the job back to the queue without spending an attempt. */
export async function yieldJob(job: Job, token: string | undefined, delayMs = 0): Promise<never> {
  await job.moveToDelayed(Date.now() + delayMs, token);
  throw new DelayedError();
}

/**
 * Abort every registered worker's jobs, give processors the budget to checkpoint
 * and yield, then force-close. Draining uses pause(), never close(): Worker.close
 * hands a pending graceful close to any later close(true), so a processor that
 * ignores its signal would hold the shutdown open past the budget.
 */
export async function shutdownAllJobs(graceMs: number): Promise<void> {
  const registered = [...workers];
  for (const worker of registered) worker.cancelAllJobs('shutdown');

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(graceMs - 2000, 500));
    timer.unref();
  });
  const paused = registered.map((worker) => worker.pause().catch(() => undefined));
  await Promise.race([Promise.all(paused), budget]);
  clearTimeout(timer);

  await Promise.all(registered.map((worker) => worker.close(true)));
}
