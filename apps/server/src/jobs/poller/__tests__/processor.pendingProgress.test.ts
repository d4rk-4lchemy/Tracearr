import { describe, expect, it } from 'vitest';
import { syncDispatcharrPendingProgress } from '../processor.js';
import type { PendingSessionData } from '../types.js';

function createPending(overrides: Partial<PendingSessionData> = {}): PendingSessionData {
  const now = 1710600000000;
  return {
    id: 'pending-1',
    confirmation: {
      rulesEvaluated: false,
      confirmedPlayback: false,
      firstSeenAt: now,
      maxViewOffset: 0,
    },
    processed: {} as any,
    server: { id: 'srv-1', name: 'Dispatcharr', type: 'dispatcharr' },
    serverUser: {
      id: 'su-1',
      username: 'user',
      thumbUrl: null,
      identityName: null,
      trustScore: 100,
      sessionCount: 0,
      lastActivityAt: null,
      createdAt: new Date(),
    },
    geo: {} as any,
    currentState: 'playing',
    startedAt: now,
    pausedDurationMs: 0,
    lastPausedAt: null,
    lastSeenAt: now,
    ...overrides,
  };
}

describe('syncDispatcharrPendingProgress', () => {
  it('copies maxViewOffset into processed.progressMs for pending Dispatcharr sessions', () => {
    const pending = createPending({
      confirmation: {
        rulesEvaluated: false,
        confirmedPlayback: false,
        firstSeenAt: 1710600000000,
        maxViewOffset: 12000,
      },
      processed: { progressMs: 0 } as any,
    });

    const updated = syncDispatcharrPendingProgress(pending, 30000);
    expect(updated.processed.progressMs).toBe(12000);
  });

  it('does not change progress for non-Dispatcharr threshold flow', () => {
    const pending = createPending({
      confirmation: {
        rulesEvaluated: false,
        confirmedPlayback: false,
        firstSeenAt: 1710600000000,
        maxViewOffset: 12000,
      },
      processed: { progressMs: 5000 } as any,
    });

    const updated = syncDispatcharrPendingProgress(pending, null);
    expect(updated).toBe(pending);
    expect(updated.processed.progressMs).toBe(5000);
  });
});
