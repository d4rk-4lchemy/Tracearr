import { describe, expect, it } from 'vitest';
import { mergeDispatcharrRealtimeSessions } from '../processor.js';
import type { MediaSession } from '../../../services/mediaServer/types.js';

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
