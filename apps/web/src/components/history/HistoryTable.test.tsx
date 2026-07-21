// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { SessionWithDetails } from '@tracearr/shared';
import { DEFAULT_COLUMN_VISIBILITY } from './HistoryFilters';
import { HistoryTable } from './HistoryTable';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 53,
    getVirtualItems: () =>
      count > 0
        ? [
            {
              index: 0,
              key: 0,
              start: 0,
              end: 53,
              size: 53,
              lane: 0,
            },
          ]
        : [],
    measureElement: vi.fn(),
  }),
}));

vi.mock('@/hooks/useServerColorMap', () => ({
  useServerColorMap: () => new Map(),
}));

function makeSession(overrides: Partial<SessionWithDetails> = {}): SessionWithDetails {
  return {
    id: 'session-1',
    serverId: 'server-1',
    serverUserId: 'user-1',
    sessionKey: 'sk-1',
    state: 'stopped',
    mediaType: 'movie',
    mediaTitle: 'Very Long Movie Name That Should Be Truncated On Mobile Layout',
    grandparentTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    year: 2026,
    thumbPath: null,
    startedAt: new Date(),
    stoppedAt: new Date(),
    durationMs: 120_000,
    totalDurationMs: 7_200_000,
    progressMs: 2_100_000,
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
    product: 'App',
    device: 'Phone',
    platform: 'iOS',
    quality: null,
    isTranscode: false,
    videoDecision: 'directplay',
    audioDecision: 'directplay',
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
    channelTitle: null,
    channelIdentifier: null,
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
      name: 'Plex',
      type: 'plex',
    },
    ...overrides,
  };
}

describe('HistoryTable mobile layout protections', () => {
  it('applies a minimum table width and content truncation classes', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable sessions={[makeSession()]} columnVisibility={DEFAULT_COLUMN_VISIBILITY} />
        </MemoryRouter>
      </TooltipProvider>
    );

    const table = screen.getByRole('table');
    expect(table.className).toContain('w-full');
    expect(table.getAttribute('style') ?? '').toContain('min-width: 1174px');

    const title = screen.getByText('Very Long Movie Name That Should Be Truncated On Mobile Layout');
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('shrink');

    const contentHeader = screen.getByRole('columnheader', { name: 'Content' });
    expect(contentHeader.getAttribute('style') ?? '').toContain('width: 300px');

    const contentCell = title.closest('td');
    expect(contentCell).not.toBeNull();
    expect(contentCell?.getAttribute('style') ?? '').toContain('width: 300px');
  });
});

describe('HistoryTable live content display', () => {
  it('shows the channel name only for live sessions', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Evening Movie',
                channelTitle: 'Classic Hits TV',
                year: null,
                server: {
                  id: 'server-1',
                  name: 'Dispatcharr',
                  type: 'dispatcharr',
                },
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.getByText('Classic Hits TV')).toBeInTheDocument();
    expect(screen.queryByText('Evening Movie')).not.toBeInTheDocument();
    expect(screen.queryByText('Abandoned')).not.toBeInTheDocument();
    expect(screen.queryByText('Sampled')).not.toBeInTheDocument();
    expect(screen.queryByText('Engaged')).not.toBeInTheDocument();
    expect(screen.queryByText('Watched')).not.toBeInTheDocument();
  });

  it('falls back to the media title when a live session has no channel name', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Fallback Channel',
                channelTitle: null,
                year: null,
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.getByText('Fallback Channel')).toBeInTheDocument();
  });

  it('does not render engagement badges for Dispatcharr catch-up history rows', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Morning News',
                channelTitle: 'News 24',
                year: null,
                totalDurationMs: 5_400_000,
                progressMs: 4_900_000,
                dispatcharrPlaybackKind: 'catchup',
                server: {
                  id: 'server-1',
                  name: 'Dispatcharr',
                  type: 'dispatcharr',
                },
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.getByText('News 24')).toBeInTheDocument();
    expect(screen.queryByText('Watched')).not.toBeInTheDocument();
    expect(screen.queryByText('Engaged')).not.toBeInTheDocument();
    expect(screen.queryByText('Sampled')).not.toBeInTheDocument();
    expect(screen.queryByText('Abandoned')).not.toBeInTheDocument();
  });

  it('shows a catch-up icon for Dispatcharr catch-up history rows', () => {
    const { container } = render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Morning News',
                channelTitle: 'News 24',
                year: null,
                dispatcharrPlaybackKind: 'catchup',
                server: {
                  id: 'server-1',
                  name: 'Dispatcharr',
                  type: 'dispatcharr',
                },
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.getByText('News 24')).toBeInTheDocument();
    expect(screen.getByTitle('Catch-up')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="history-catchup-badge"]')).toBeTruthy();
  });

  it('does not show a catch-up icon for normal Dispatcharr live history rows', () => {
    const { container } = render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Evening Show',
                channelTitle: 'Live Channel',
                year: null,
                dispatcharrPlaybackKind: 'live',
                server: {
                  id: 'server-1',
                  name: 'Dispatcharr',
                  type: 'dispatcharr',
                },
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.queryByTitle('Catch-up')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="history-catchup-badge"]')).toBeNull();
  });

  it('does not show a catch-up icon for non-Dispatcharr history rows', () => {
    const { container } = render(
      <TooltipProvider>
        <MemoryRouter>
          <HistoryTable
            sessions={[
              makeSession({
                mediaType: 'live',
                mediaTitle: 'Catch-up Looking Title',
                channelTitle: 'Plex Live',
                year: null,
                dispatcharrPlaybackKind: 'catchup',
                server: {
                  id: 'server-1',
                  name: 'Plex',
                  type: 'plex',
                },
              }),
            ]}
            columnVisibility={DEFAULT_COLUMN_VISIBILITY}
          />
        </MemoryRouter>
      </TooltipProvider>
    );

    expect(screen.queryByTitle('Catch-up')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="history-catchup-badge"]')).toBeNull();
  });
});
