// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NowPlayingCard } from './NowPlayingCard';
import type { ActiveSession } from '@tracearr/shared';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'user' } }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({
    isMultiServer: false,
    selectedServers: [{ id: 'server-1', color: null }],
    selectedServerIds: ['server-1'],
    selectedServerId: 'server-1',
  }),
}));

vi.mock('@/hooks/useEstimatedProgress', () => ({
  useEstimatedProgress: () => ({
    estimatedProgressMs: 60_000,
    progressPercent: 10,
  }),
}));

vi.mock('./TerminateSessionDialog', () => ({
  TerminateSessionDialog: () => null,
}));

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'session-1',
    serverId: 'server-1',
    serverUserId: 'user-1',
    sessionKey: 'sk-1',
    state: 'playing',
    mediaType: 'live',
    mediaTitle: 'Morning News',
    grandparentTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    year: null,
    thumbPath: null,
    ratingKey: null,
    externalSessionId: null,
    startedAt: new Date(),
    stoppedAt: null,
    durationMs: null,
    totalDurationMs: null,
    progressMs: null,
    lastPausedAt: null,
    pausedDurationMs: 0,
    referenceId: null,
    watched: false,
    ipAddress: '127.0.0.1',
    geoCity: null,
    geoRegion: null,
    geoCountry: null,
    geoContinent: null,
    geoPostal: null,
    geoLat: null,
    geoLon: null,
    geoAsnNumber: null,
    geoAsnOrganization: null,
    playerName: 'Player',
    deviceId: 'device-1',
    product: null,
    device: null,
    platform: null,
    quality: null,
    isTranscode: false,
    videoDecision: null,
    audioDecision: null,
    bitrate: null,
    sourceVideoCodec: null,
    sourceAudioCodec: null,
    sourceAudioChannels: null,
    sourceVideoWidth: null,
    sourceVideoHeight: null,
    sourceVideoDetails: null,
    sourceAudioDetails: null,
    streamVideoCodec: null,
    streamAudioCodec: null,
    streamVideoDetails: null,
    streamAudioDetails: null,
    transcodeInfo: null,
    subtitleInfo: null,
    channelTitle: 'Dispatch News',
    channelIdentifier: 'ch-1',
    channelThumb: null,
    artistName: null,
    albumName: null,
    trackNumber: null,
    discNumber: null,
    user: {
      id: 'user-1',
      username: 'alice',
      thumbUrl: null,
      identityName: null,
    },
    server: {
      id: 'server-1',
      name: 'Dispatcharr',
      type: 'dispatcharr',
    },
    canTerminate: false,
    ...overrides,
  };
}

describe('NowPlayingCard ffmpeg speed display', () => {
  it('shows ffmpeg speed for dispatcharr live streams', () => {
    render(
      <NowPlayingCard
        session={makeSession({
          transcodeInfo: { speed: 1.03 },
          server: { id: 'server-1', name: 'Dispatcharr', type: 'dispatcharr' },
          mediaType: 'live',
        })}
      />
    );

    expect(screen.getByText('1.03x')).toBeTruthy();
  });

  it('keeps default duration fallback for non-dispatcharr streams', () => {
    render(
      <NowPlayingCard
        session={makeSession({
          transcodeInfo: { speed: 1.25 },
          server: { id: 'server-2', name: 'Plex', type: 'plex' },
          mediaType: 'live',
        })}
      />
    );

    expect(screen.queryByText('1.25x')).toBeNull();
    expect(screen.getByText('--:--')).toBeTruthy();
  });

  it('proxies absolute Dispatcharr live channel logos for card artwork', () => {
    const absoluteThumbUrl =
      'https://dispatcharr.example.com/api/channels/logos/4671/cache/?ts=123#ignored';

    const { container } = render(
      <NowPlayingCard
        session={makeSession({
          thumbPath: absoluteThumbUrl,
          server: { id: 'server-1', name: 'Dispatcharr', type: 'dispatcharr' },
          mediaType: 'live',
        })}
      />
    );

    const poster = container.querySelector('img[alt="Dispatch News"]');
    expect(poster).toBeTruthy();
    expect(poster?.getAttribute('src')).toBe(
      '/api/v1/images/proxy?server=server-1&url=https%3A%2F%2Fdispatcharr.example.com%2Fapi%2Fchannels%2Flogos%2F4671%2Fcache%2F%3Fts%3D123%23ignored&width=200&height=300'
    );
  });
});
