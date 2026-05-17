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
    expect(table.getAttribute('style') ?? '').toContain('min-width: 1074px');

    const title = screen.getByText('Very Long Movie Name That Should Be Truncated On Mobile Layout');
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('flex-1');
  });
});
