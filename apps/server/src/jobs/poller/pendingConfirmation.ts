/**
 * Pending session confirmation for the poller path. SSE runs its own
 * inline confirmation logic in sseProcessor.ts; both create pending entries
 * with the same PendingSessionData shape, but the poller uses these helpers
 * to advance/confirm them while SSE does not import this module.
 */

import type { SessionState } from '@tracearr/shared';
import { isPlaybackConfirmed, updateConfirmationState } from './stateTracker.js';
import type { PendingSessionData } from './types.js';

/** Pause accumulation using epoch numbers (pending sessions are JSON-serialized in Redis). */
export function calculatePendingPauseAccumulation(input: {
  previousState: string;
  newState: string;
  pausedDurationMs: number;
  lastPausedAt: number | null;
  now: number;
}): { pausedDurationMs: number; lastPausedAt: number | null } {
  let { pausedDurationMs, lastPausedAt } = input;

  if (input.previousState === 'paused' && input.newState === 'playing') {
    if (lastPausedAt) {
      pausedDurationMs += input.now - lastPausedAt;
    }
    lastPausedAt = null;
  } else if (input.previousState === 'playing' && input.newState === 'paused') {
    lastPausedAt = input.now;
  }

  return { pausedDurationMs, lastPausedAt };
}

/** Update pending session with new data and check if it's ready to persist. */
export function updatePendingSession(
  pendingData: PendingSessionData,
  newState: string,
  viewOffset: number | undefined,
  now: number,
  confirmThresholdMs?: number,
  processed?: PendingSessionData['processed']
): { updatedData: PendingSessionData; isConfirmed: boolean } {
  const previousState = pendingData.currentState ?? 'playing';

  const { pausedDurationMs, lastPausedAt } = calculatePendingPauseAccumulation({
    previousState,
    newState,
    pausedDurationMs: pendingData.pausedDurationMs,
    lastPausedAt: pendingData.lastPausedAt,
    now,
  });

  const previousProgrammeStart = Date.parse(
    pendingData.processed.dispatcharrCatchupEpgStartAt ?? ''
  );
  const nextProgrammeStart = Date.parse(processed?.dispatcharrCatchupEpgStartAt ?? '');
  const catchupProgrammeChanged =
    pendingData.server.type === 'dispatcharr' &&
    pendingData.processed.dispatcharrPlaybackKind === 'catchup' &&
    processed?.dispatcharrPlaybackKind === 'catchup' &&
    Number.isFinite(previousProgrammeStart) &&
    Number.isFinite(nextProgrammeStart) &&
    previousProgrammeStart !== nextProgrammeStart;

  // Progress belongs to the EPG window, but confirmation age belongs to the
  // connection. Do not carry a completed programme's offsets into the next one.
  const confirmation = catchupProgrammeChanged
    ? { ...pendingData.confirmation, initialViewOffset: null, maxViewOffset: 0 }
    : pendingData.confirmation;
  const currentViewOffset = viewOffset ?? confirmation.maxViewOffset;
  const updatedConfirmation = updateConfirmationState(confirmation, currentViewOffset);
  const confirmed = isPlaybackConfirmed(
    updatedConfirmation,
    currentViewOffset,
    newState,
    now,
    confirmThresholdMs
  );

  // The latest snapshot owns metadata; progress is monotonic within its window.
  // Partial or out-of-order snapshots must not regress the progress shown on
  // the pending card or persisted at confirmation.
  const latestProgressMs = Math.max(
    catchupProgrammeChanged ? 0 : (pendingData.processed.progressMs ?? 0),
    processed?.progressMs ?? 0
  );
  const refreshedProcessed =
    processed && latestProgressMs > (processed.progressMs ?? 0)
      ? { ...processed, progressMs: latestProgressMs }
      : (processed ?? pendingData.processed);

  const updatedData: PendingSessionData = {
    ...pendingData,
    processed: refreshedProcessed,
    confirmation: confirmed
      ? { ...updatedConfirmation, confirmedPlayback: true }
      : updatedConfirmation,
    currentState: newState as SessionState,
    pausedDurationMs,
    lastPausedAt,
    lastSeenAt: now,
  };

  return { updatedData, isConfirmed: confirmed };
}
