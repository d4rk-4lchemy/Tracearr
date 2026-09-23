/**
 * How hard a background precache pass may push a media server.
 *
 * Raw stream count is a poor signal: ten direct plays on a big host is
 * nothing, two transcodes on a NAS is the whole box. Weighting transcodes
 * higher approximates what the image transcoder is competing with.
 */

/** Leaves at least two of imageProxy's six fetch slots for live browsing:
 *  "idle" means nobody is streaming, not that nobody is using the web UI. */
export const WARM_CONCURRENCY_IDLE = 4;
export const WARM_CONCURRENCY_LIGHT = 2;
/** Floor, never zero: a server that always has viewers must still converge. */
export const WARM_CONCURRENCY_HEAVY = 1;
export const TRANSCODE_WEIGHT = 4;
const LIGHT_LOAD_MAX = 4;

/** Consecutive batches in which every warm failed. A batch is up to 50 items,
 *  so counting individual warms would either trip on one bad batch or let
 *  hundreds of failures through before reacting. */
export const FAILURE_BACKOFF_BATCHES = 2;
export const FAILURE_BACKOFF_BASE_MS = 30_000;
export const FAILURE_BACKOFF_MAX_MS = 30 * 60 * 1000;

export function streamPressure(sessions: ReadonlyArray<{ isTranscode: boolean }>): number {
  return sessions.reduce((score, s) => score + (s.isTranscode ? TRANSCODE_WEIGHT : 1), 0);
}

export function warmConcurrencyFor(pressure: number): number {
  if (pressure <= 0) return WARM_CONCURRENCY_IDLE;
  if (pressure <= LIGHT_LOAD_MAX) return WARM_CONCURRENCY_LIGHT;
  return WARM_CONCURRENCY_HEAVY;
}

export function backoffDelayMs(round: number): number {
  return Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** round, FAILURE_BACKOFF_MAX_MS);
}
