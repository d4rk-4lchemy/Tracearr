// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeFormat } from '@/lib/timeFormat';
import { NowPlayingCard } from './NowPlayingCard';
import type { ActiveSession } from '@tracearr/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'pages:automations.options.trailer' ? 'Trailer' : key),
  }),
}));

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
  useEstimatedProgress: (session: ActiveSession) => ({
    estimatedProgressMs: session.progressMs ?? 0,
    progressPercent:
      session.totalDurationMs && session.progressMs
        ? (session.progressMs / session.totalDurationMs) * 100
        : 0,
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
    serverVersionKey: null,
    parentRatingKey: null,
    grandparentRatingKey: null,
    mediaId: null,
    showMediaId: null,
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
    externalSessionId: null,
    startedAt: new Date(),
    stoppedAt: null,
    durationMs: null,
    totalDurationMs: null,
    progressMs: null,
    progressUpdatedAt: new Date(),
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
    isLocal: false,
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

function getProgressTranslatePercent(container: HTMLElement): number | null {
  const indicator = container.querySelector<HTMLElement>('[style*="translateX"]');
  const transform = indicator?.style.transform ?? '';
  const match = transform.match(/translateX\(-([0-9.]+)%\)/);
  return match?.[1] ? Number(match[1]) : null;
}

describe('NowPlayingCard ffmpeg speed display', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([null, 2026])('labels a Plex trailer with year %s without changing its title', (year) => {
    render(
      <NowPlayingCard
        session={makeSession({
          mediaType: 'trailer',
          mediaTitle: 'Movie title',
          year,
          server: { id: 'plex-1', name: 'Plex', type: 'plex' },
        })}
      />
    );
    expect(screen.getByText('Movie title')).toBeTruthy();
    expect(screen.getByText(year ? `Trailer · ${year}` : 'Trailer')).toBeTruthy();
  });

  it('shows a catch-up icon for Dispatcharr catch-up cards', () => {
    const { container } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
        })}
      />
    );

    expect(screen.getByTitle('Catch-up')).toBeTruthy();
    expect(container.querySelector('[data-testid="catchup-badge"]')).toBeTruthy();
  });

  it('does not show a catch-up icon for Dispatcharr live sessions without catch-up', () => {
    render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'live',
        })}
      />
    );

    expect(screen.queryByTitle('Catch-up')).toBeNull();
  });

  it('does not show a catch-up icon for non-Dispatcharr live sessions', () => {
    render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          server: { id: 'server-2', name: 'Plex', type: 'plex' },
        })}
      />
    );

    expect(screen.queryByTitle('Catch-up')).toBeNull();
  });

  it('renders catch-up before quality and device badges', () => {
    const { container } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
        })}
      />
    );

    const badgeRow = container.querySelector('.flex.shrink-0.items-center.gap-1\\.5');
    const badgeIds = Array.from(badgeRow?.children ?? []).map((child) =>
      (child as HTMLElement).getAttribute('data-testid')
    );

    expect(badgeIds.slice(0, 3)).toEqual(['catchup-badge', 'quality-badge', 'device-badge']);

    const catchupBadge = container.querySelector('[data-testid="catchup-badge"]');
    expect(catchupBadge?.className).toContain('rounded-full');
    expect(catchupBadge?.className).toContain('bg-blue-500/15');
    expect(catchupBadge?.className).toContain('text-blue-600');
  });

  it('shows 24-hour start and end times for Dispatcharr catch-up cards', () => {
    setTimeFormat('24h');

    render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T13:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T13:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T15:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 0,
        })}
      />
    );

    expect(screen.getByText('13:30')).toBeTruthy();
    expect(screen.getByText('15:00')).toBeTruthy();
    expect(screen.queryByText('1.03x')).toBeNull();
  });

  it('shows 12-hour start and end times for Dispatcharr catch-up cards', () => {
    setTimeFormat('12h');

    render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T13:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T13:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T15:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 0,
        })}
      />
    );

    expect(screen.getByText('1:30 PM')).toBeTruthy();
    expect(screen.getByText('3:00 PM')).toBeTruthy();
  });

  it('keeps catch-up progress empty when EPG data is missing', () => {
    const { container } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T06:15:00.000Z',
          dispatcharrCatchupEpgStartAt: null,
          dispatcharrCatchupEpgEndAt: null,
          totalDurationMs: 5_400_000,
          progressMs: 2_700_000,
        })}
      />
    );

    expect(screen.getAllByText('--:--')).toHaveLength(2);
    expect(getProgressTranslatePercent(container)).toBe(50);
  });

  it('uses the backend progress after programme_start changes', () => {
    const { container, rerender } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T07:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 0,
        })}
      />
    );

    rerender(
      <NowPlayingCard
        session={makeSession({
          mediaTitle: 'Late News',
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T06:15:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T07:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 2_700_000,
        })}
      />
    );

    expect(screen.getByText('Late News')).toBeTruthy();
    expect(getProgressTranslatePercent(container)).toBe(50);
  });

  it('keeps backend catch-up progress across refetches when programme_start is unchanged', () => {
    const initialProgressUpdatedAt = new Date('2026-07-19T05:30:00.000Z');
    const refetchProgressUpdatedAt = new Date('2026-07-19T05:31:00.000Z');

    const { container, rerender } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T07:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 0,
          progressUpdatedAt: initialProgressUpdatedAt,
        })}
      />
    );

    rerender(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          dispatcharrCatchupAnchorAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T07:00:00.000Z',
          totalDurationMs: 5_400_000,
          progressMs: 60_000,
          progressUpdatedAt: refetchProgressUpdatedAt,
        })}
      />
    );

    expect(getProgressTranslatePercent(container)).toBeCloseTo(98.889, 2);
  });

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
    expect(screen.getAllByText('--:--')).toHaveLength(2);
  });

  it.each(['movie', 'episode', 'live', 'track'] as const)(
    'contains the complete %s artwork',
    (mediaType) => {
      const { container } = render(
        <NowPlayingCard
          session={makeSession({
            mediaType,
            thumbPath: '/Items/art/Images/Primary',
            server: { id: 'server-1', name: 'Jellyfin', type: 'jellyfin' },
          })}
        />
      );
      const poster = container.querySelector('img[src*="images/proxy"]');
      expect(screen.getByTestId('card-artwork')).not.toHaveClass('bg-muted');
      expect(screen.getByTestId('card-artwork')).not.toHaveClass('overflow-hidden');
      expect(poster).toHaveClass('max-h-28');
      expect(poster).toHaveClass('max-w-20');
      expect(poster).not.toHaveClass('shadow-lg');
      if (mediaType === 'live') {
        expect(poster).not.toHaveClass('rounded-lg');
      } else {
        expect(poster).toHaveClass('rounded-lg');
      }
      expect(screen.getByTestId('artwork-playback-overlay')).not.toHaveClass('bg-black/50');
      expect(screen.getByTestId('artwork-playback-overlay')).toHaveClass(
        'opacity-0',
        'group-hover:opacity-100'
      );
      expect(screen.getByTestId('artwork-playback-overlay').parentElement).toHaveClass(
        'overflow-visible'
      );
      expect(container.querySelector('svg.lucide-play')).toHaveClass('h-8', 'w-8', 'shrink-0');
      expect(poster).toHaveClass('transition-[filter]', 'group-hover:brightness-50');
      expect(poster).not.toHaveClass('brightness-50');
      expect(screen.queryByTestId('artwork-dimmer')).toBeNull();
      expect(screen.getByTestId('artwork-playback-overlay')).not.toHaveClass('brightness-50');
      expect(container.querySelector('svg.lucide-play')?.parentElement).toBe(
        screen.getByTestId('artwork-playback-overlay')
      );
      expect(poster?.getAttribute('src')).toContain('&artwork=2');
    }
  );

  it.each(['dispatcharr', 'plex', 'jellyfin', 'emby'] as const)(
    'keeps live artwork square and the outer card rounded for %s',
    (type) => {
      const { container } = render(
        <NowPlayingCard
          session={makeSession({
            thumbPath: '/logo.png',
            server: { id: 'server-1', name: type, type },
          })}
        />
      );
      expect(container.querySelector('img[src*="images/proxy"]')).not.toHaveClass('rounded-lg');
      expect(container.firstElementChild).toHaveClass('rounded-xl');
    }
  );

  it('keeps paused catch-up artwork square with a visible, undimmed Pause icon', () => {
    const { container } = render(
      <NowPlayingCard
        session={makeSession({
          dispatcharrPlaybackKind: 'catchup',
          state: 'paused',
          thumbPath: '/catchup.png',
        })}
      />
    );
    expect(container.querySelector('img[src*="images/proxy"]')).not.toHaveClass(
      'rounded-lg',
      'shadow-lg'
    );
    expect(screen.getByTestId('artwork-playback-overlay')).toHaveClass('opacity-100');
    expect(screen.getByTestId('artwork-playback-overlay')).not.toHaveClass(
      'bg-black/50',
      'opacity-0'
    );
    expect(container.querySelector('svg.lucide-pause')).toHaveClass(
      'relative',
      'h-8',
      'w-8',
      'shrink-0'
    );
    expect(container.querySelector('img[src*="images/proxy"]')).toHaveClass('brightness-50');
    expect(screen.queryByTestId('artwork-dimmer')).toBeNull();
    expect(screen.getByTestId('artwork-playback-overlay')).not.toHaveClass('brightness-50');
    expect(screen.getByTestId('card-artwork')).not.toHaveClass('bg-muted', 'overflow-hidden');
  });

  it('keeps the gray artwork placeholder when no image exists', () => {
    render(<NowPlayingCard session={makeSession({ thumbPath: null })} />);

    expect(screen.getByTestId('card-artwork')).toHaveClass('bg-muted');
    expect(screen.queryByTestId('artwork-dimmer')).toBeNull();
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
      '/api/v1/images/proxy?server=server-1&url=https%3A%2F%2Fdispatcharr.example.com%2Fapi%2Fchannels%2Flogos%2F4671%2Fcache%2F%3Fts%3D123%23ignored&width=360&height=540&artwork=2'
    );
  });
});

function renderCard(overrides: Partial<ActiveSession>) {
  render(
    <NowPlayingCard
      session={makeSession({ playerName: null, totalDurationMs: 7_200_000, ...overrides })}
    />
  );
  return screen.getByTestId('device-badge');
}

describe('NowPlayingCard device icon', () => {
  it('names the client on hover', () => {
    expect(renderCard({ playerName: "Emily's Fire TV" })).toHaveAttribute(
      'title',
      "Emily's Fire TV"
    );
  });

  it('builds a name from the app and hardware when the client sent none', () => {
    expect(renderCard({ product: 'Plex for Roku', device: '50S425' })).toHaveAttribute(
      'title',
      'Plex for Roku - 50S425'
    );
  });

  it('carries no hover text when the session reports no device at all', () => {
    expect(renderCard({})).not.toHaveAttribute('title');
  });
});

describe('NowPlayingCard transcoder bar and buffering', () => {
  it('draws the transcoder segment ahead of the playhead', () => {
    renderCard({ progressMs: 720_000, transcodeInfo: { maxOffsetAvailable: 1800 } });
    expect(screen.getByTestId('progress-buffered')).toHaveStyle({ width: '25%' });
  });

  it('falls back to transcode percent when the server gives no offset (Jellyfin)', () => {
    renderCard({ progressMs: 720_000, transcodeInfo: { progress: 40 } });
    expect(screen.getByTestId('progress-buffered')).toHaveStyle({ width: '40%' });
  });

  it('draws nothing for direct play', () => {
    renderCard({ progressMs: 720_000, transcodeInfo: null });
    expect(screen.queryByTestId('progress-buffered')).toBeNull();
  });

  it('draws nothing when the transcoder is behind the playhead', () => {
    renderCard({ progressMs: 720_000, transcodeInfo: { maxOffsetAvailable: 300 } });
    expect(screen.queryByTestId('progress-buffered')).toBeNull();
  });

  it('labels a buffering session', () => {
    renderCard({ state: 'playing', buffering: true });
    expect(screen.getByText('playback.buffering')).toBeInTheDocument();
  });
});
