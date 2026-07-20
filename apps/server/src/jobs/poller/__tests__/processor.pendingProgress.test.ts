import { describe, expect, it } from 'vitest';
import { mergeDispatcharrRealtimeSessions, syncDispatcharrPendingProgress } from '../processor.js';
import type { MediaSession } from '../../../services/mediaServer/types.js';
import type { PendingSessionData } from '../types.js';

function createPending(overrides: Partial<PendingSessionData> = {}): PendingSessionData {
  const now = 1710600000000;
  return {
    id: 'pending-1',
    confirmation: {
      confirmedPlayback: false,
      firstSeenAt: now,
      maxViewOffset: 0,
      initialViewOffset: null,
    },
    processed: {} as any,
    server: { id: 'srv-1', name: 'Dispatcharr', type: 'dispatcharr' },
    serverUser: {
      id: 'su-1',
      userId: 'user-1',
      username: 'user',
      thumbUrl: null,
      identityName: null,
      trustScore: 100,
      sessionCount: 0,
      lastActivityAt: null,
      createdAt: new Date(),
      identityServerUserIds: ['su-1'],
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
        confirmedPlayback: false,
        firstSeenAt: 1710600000000,
        maxViewOffset: 12000,
        initialViewOffset: null,
      },
      processed: { progressMs: 0 } as any,
    });

    const updated = syncDispatcharrPendingProgress(pending, 30000);
    expect(updated.processed.progressMs).toBe(12000);
  });

  it('keeps refreshed pending metadata while preserving max progress', () => {
    const pending = createPending({
      confirmation: {
        confirmedPlayback: false,
        firstSeenAt: 1710600000000,
        maxViewOffset: 12000,
        initialViewOffset: null,
      },
      processed: {
        progressMs: 12000,
        mediaTitle: 'Morning News',
        totalDurationMs: 5_400_000,
        dispatcharrCatchupEpgStartAt: '2026-07-19T05:30:00.000Z',
        dispatcharrCatchupEpgEndAt: '2026-07-19T07:00:00.000Z',
      } as any,
    });

    const updated = syncDispatcharrPendingProgress(
      {
        ...pending,
        processed: {
          ...pending.processed,
          progressMs: 1000,
          mediaTitle: 'Late News',
          totalDurationMs: 3_600_000,
          dispatcharrCatchupEpgStartAt: '2026-07-19T07:00:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T08:00:00.000Z',
        },
      },
      30000
    );

    expect(updated.processed).toMatchObject({
      progressMs: 12000,
      mediaTitle: 'Late News',
      totalDurationMs: 3_600_000,
      dispatcharrCatchupEpgStartAt: '2026-07-19T07:00:00.000Z',
      dispatcharrCatchupEpgEndAt: '2026-07-19T08:00:00.000Z',
    });
  });

  it('does not change progress for non-Dispatcharr threshold flow', () => {
    const pending = createPending({
      confirmation: {
        confirmedPlayback: false,
        firstSeenAt: 1710600000000,
        maxViewOffset: 12000,
        initialViewOffset: null,
      },
      processed: { progressMs: 5000 } as any,
    });

    const updated = syncDispatcharrPendingProgress(pending, null);
    expect(updated).toBe(pending);
    expect(updated.processed.progressMs).toBe(5000);
  });
});

function createMediaSession(overrides: Partial<MediaSession> = {}): MediaSession {
  return {
    sessionKey: 'channel-1:client-1',
    mediaId: 'channel-1',
    user: { id: 'user-1', username: 'User One' },
    media: { title: 'Original Program', type: 'live', durationMs: 0 },
    live: {
      channelTitle: 'Channel One',
      channelIdentifier: 'channel-1',
    },
    playback: { state: 'playing', positionMs: 0, progressPercent: 0 },
    player: { name: 'Dispatcharr Client', deviceId: 'client-1', platform: 'Dispatcharr' },
    network: { ipAddress: '203.0.113.10', isLocal: false },
    quality: {
      bitrate: 0,
      isTranscode: false,
      videoDecision: 'directplay',
      audioDecision: 'directplay',
    },
    ...overrides,
  };
}

describe('mergeDispatcharrRealtimeSessions', () => {
  it('uses REST live metadata when it matches a realtime live session key', () => {
    const wsLive = createMediaSession({
      media: { title: 'Original Program', type: 'live', durationMs: 0 },
    });
    const restLive = createMediaSession({
      media: { title: 'Next Program', type: 'live', durationMs: 0 },
    });
    const restVod = createMediaSession({
      sessionKey: 'vod-client-1',
      mediaId: 'movie-1',
      media: { title: 'VOD Movie', type: 'movie', durationMs: 7200000 },
      live: undefined,
    });

    const merged = mergeDispatcharrRealtimeSessions([wsLive], [restLive, restVod]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.sessionKey).toBe('channel-1:client-1');
    expect(merged[0]?.media.title).toBe('Next Program');
    expect(merged[1]?.sessionKey).toBe('vod-client-1');
  });

  it('keeps realtime live sessions when REST has no matching live session', () => {
    const wsLive = createMediaSession();

    const merged = mergeDispatcharrRealtimeSessions([wsLive], []);

    expect(merged).toEqual([wsLive]);
  });
});
