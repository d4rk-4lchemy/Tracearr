import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveSession } from '@tracearr/shared';

function parseUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestampMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface CatchupProgressState {
  baseProgressMs: number;
  totalDurationMs: number | null;
  anchorUpdatedAtMs: number | null;
}

function getBaseProgressMs(session: ActiveSession): { baseProgressMs: number; totalDurationMs: number | null } {
  const anchorMs = parseUtcMs(session.dispatcharrCatchupAnchorAt);
  const epgStartMs = parseUtcMs(session.dispatcharrCatchupEpgStartAt);
  const epgEndMs = parseUtcMs(session.dispatcharrCatchupEpgEndAt);

  if (anchorMs === null || epgStartMs === null || epgEndMs === null || epgEndMs <= epgStartMs) {
    const fallbackProgressMs = Math.max(0, session.progressMs ?? 0);
    return {
      baseProgressMs: fallbackProgressMs,
      totalDurationMs: null,
    };
  }

  const totalDurationMs = epgEndMs - epgStartMs;
  const anchorProgressMs = clamp(anchorMs - epgStartMs, 0, totalDurationMs);
  const progressFromServerMs = session.progressMs ?? anchorProgressMs;
  const baseProgressMs = clamp(progressFromServerMs, 0, totalDurationMs);
  return { baseProgressMs, totalDurationMs };
}

function getProgressState(session: ActiveSession): CatchupProgressState {
  const { baseProgressMs, totalDurationMs } = getBaseProgressMs(session);
  return {
    baseProgressMs,
    totalDurationMs,
    anchorUpdatedAtMs: parseTimestampMs(session.progressUpdatedAt),
  };
}

function getEstimatedProgressMs(
  progressState: CatchupProgressState,
  playbackState: ActiveSession['state']
): number {
  const maxProgress = progressState.totalDurationMs ?? Infinity;
  if (playbackState !== 'playing' || progressState.anchorUpdatedAtMs === null) {
    return clamp(progressState.baseProgressMs, 0, maxProgress);
  }

  const elapsedMs = Math.max(0, Date.now() - progressState.anchorUpdatedAtMs);
  return clamp(progressState.baseProgressMs + elapsedMs, 0, maxProgress);
}

export function formatDispatcharrCatchupClock(value: string | null | undefined): string {
  const parsedMs = parseUtcMs(value);
  if (parsedMs === null) return '--:--';

  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(parsedMs));
}

export function useDispatcharrCatchupCardProgress(session: ActiveSession) {
  const [progressState, setProgressState] = useState(() => getProgressState(session));
  const anchorRef = useRef(session.dispatcharrCatchupAnchorAt ?? null);
  const epgStartRef = useRef(session.dispatcharrCatchupEpgStartAt ?? null);
  const epgEndRef = useRef(session.dispatcharrCatchupEpgEndAt ?? null);
  const progressRef = useRef(session.progressMs);
  const stateRef = useRef(session.state);
  const sessionIdRef = useRef(session.id);

  useEffect(() => {
    const nextProgressState = getProgressState(session);
    const sessionChanged = session.id !== sessionIdRef.current;
    const anchorChanged = (session.dispatcharrCatchupAnchorAt ?? null) !== anchorRef.current;
    const epgStartChanged = (session.dispatcharrCatchupEpgStartAt ?? null) !== epgStartRef.current;
    const epgEndChanged = (session.dispatcharrCatchupEpgEndAt ?? null) !== epgEndRef.current;
    const progressChanged = session.progressMs !== progressRef.current;
    const stateChanged = session.state !== stateRef.current;

    setProgressState((current) => {
      const currentEstimatedProgressMs = getEstimatedProgressMs(current, stateRef.current);
      const maxProgress = nextProgressState.totalDurationMs ?? Infinity;

      if (sessionChanged || anchorChanged || epgStartChanged || epgEndChanged) {
        return nextProgressState;
      }

      if (stateChanged) {
        if (session.state === 'playing') {
          if (nextProgressState.baseProgressMs > currentEstimatedProgressMs) {
            return nextProgressState;
          }

          return {
            baseProgressMs: clamp(currentEstimatedProgressMs, 0, maxProgress),
            totalDurationMs: nextProgressState.totalDurationMs,
            anchorUpdatedAtMs: Date.now(),
          };
        }

        return {
          baseProgressMs: clamp(
            Math.max(currentEstimatedProgressMs, nextProgressState.baseProgressMs),
            0,
            maxProgress
          ),
          totalDurationMs: nextProgressState.totalDurationMs,
          anchorUpdatedAtMs: nextProgressState.anchorUpdatedAtMs,
        };
      }

      if (progressChanged && nextProgressState.baseProgressMs > currentEstimatedProgressMs) {
        return nextProgressState;
      }

      if (nextProgressState.totalDurationMs !== current.totalDurationMs) {
        return {
          baseProgressMs: clamp(current.baseProgressMs, 0, maxProgress),
          totalDurationMs: nextProgressState.totalDurationMs,
          anchorUpdatedAtMs: current.anchorUpdatedAtMs,
        };
      }

      return current;
    });

    anchorRef.current = session.dispatcharrCatchupAnchorAt ?? null;
    epgStartRef.current = session.dispatcharrCatchupEpgStartAt ?? null;
    epgEndRef.current = session.dispatcharrCatchupEpgEndAt ?? null;
    progressRef.current = session.progressMs;
    stateRef.current = session.state;
    sessionIdRef.current = session.id;
  }, [
    session.dispatcharrCatchupAnchorAt,
    session.dispatcharrCatchupEpgEndAt,
    session.dispatcharrCatchupEpgStartAt,
    session.id,
    session.progressMs,
    session.state,
    session.totalDurationMs,
  ]);

  const [estimatedProgressMs, setEstimatedProgressMs] = useState(() =>
    getEstimatedProgressMs(progressState, session.state)
  );

  useEffect(() => {
    setEstimatedProgressMs(getEstimatedProgressMs(progressState, session.state));
  }, [progressState, session.state]);

  useEffect(() => {
    if (session.state !== 'playing' || progressState.totalDurationMs === null) return;

    const intervalId = setInterval(() => {
      setEstimatedProgressMs(getEstimatedProgressMs(progressState, session.state));
    }, 1000);

    return () => clearInterval(intervalId);
  }, [progressState, session.state]);

  const progressPercent = useMemo(() => {
    if (!progressState.totalDurationMs || progressState.totalDurationMs <= 0) return 0;
    return Math.min((estimatedProgressMs / progressState.totalDurationMs) * 100, 100);
  }, [estimatedProgressMs, progressState.totalDurationMs]);

  return {
    estimatedProgressMs,
    progressPercent,
    totalDurationMs: progressState.totalDurationMs,
    startLabel: formatDispatcharrCatchupClock(session.dispatcharrCatchupEpgStartAt ?? null),
    endLabel: formatDispatcharrCatchupClock(session.dispatcharrCatchupEpgEndAt ?? null),
  };
}
