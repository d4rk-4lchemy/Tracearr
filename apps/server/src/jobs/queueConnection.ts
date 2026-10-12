/**
 * Shared BullMQ wiring for the queue modules.
 *
 * The prefix has to match between a Queue and its Worker or they operate on
 * different keyspaces, so it is computed in one place rather than per module.
 */

import type { ConnectionOptions } from 'bullmq';
import { getRedisPrefix } from '@tracearr/shared';

/** BullMQ opens its own connections from these - workers need blocking ones. */
export function queueConnectionOptions(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}

/** Starts on the next multiple of the interval; with `every` alone a re-added scheduler runs at once. */
export function everyAligned(every: number): { every: number; startDate: Date } {
  return { every, startDate: new Date(Math.ceil(Date.now() / every) * every) };
}

/** Read per call, not cached: index.ts sets REDIS_PREFIX before any queue starts. */
export function getBullPrefix(): string {
  return `${getRedisPrefix()}bull`;
}
