import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { LocationStats, ViolationWithDetails } from '@tracearr/shared';
import { ViolationDetail } from './ViolationDetail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServerColorMap', () => ({ useServerColorMap: () => new Map() }));

const mapProps = vi.hoisted(() => ({ locations: [] as LocationStats[] }));
vi.mock('@/components/map/StreamMap', () => ({
  StreamMap: ({ locations }: { locations: LocationStats[] }) => {
    mapProps.locations = locations;
    return null;
  },
}));

const violation = {
  id: 'v-1',
  ruleId: 'rule-1',
  serverUserId: 'su-1',
  sessionId: 'sess-1',
  severity: 'high',
  data: {},
  createdAt: new Date('2024-01-01T20:00:00Z'),
  acknowledgedAt: null,
  rule: { id: 'rule-1', name: 'Cap', type: null },
  user: { id: 'su-1', username: 'alice', thumbUrl: null, serverId: 'srv-1', identityName: null },
  server: { id: 'srv-1', name: 'Basement', type: 'plex' },
  session: {
    id: 'sess-1',
    mediaTitle: 'Pilot',
    mediaType: 'episode',
    grandparentTitle: 'Lost',
    mediaId: 'episode-1',
    showMediaId: 'show-1',
    seasonNumber: 1,
    episodeNumber: 2,
    year: null,
    ipAddress: '10.0.0.9',
    geoCity: null,
    geoRegion: null,
    geoCountry: null,
    isLocal: false,
    geoContinent: null,
    geoPostal: null,
    geoLat: null,
    geoLon: null,
    playerName: null,
    device: null,
    deviceId: null,
    platform: null,
    product: null,
    quality: null,
    startedAt: new Date('2024-01-01T20:00:00Z'),
  },
} as unknown as ViolationWithDetails;

let current = violation;

vi.mock('@/hooks/queries', () => ({
  useViolation: () => ({ data: current, isLoading: false }),
  useSettings: () => ({ data: undefined }),
  useAcknowledgeViolation: () => ({ mutate: vi.fn(), isPending: false }),
  useDismissViolation: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/violations/v-1']}>
      <Routes>
        <Route path="/violations/:id" element={<ViolationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ViolationDetail sessions table', () => {
  it('links the show and the episode to their media pages', () => {
    current = violation;
    renderPage();

    expect(screen.getByRole('link', { name: 'Lost' })).toHaveAttribute('href', '/media/show-1');
    expect(screen.getByRole('link', { name: /Pilot/ })).toHaveAttribute('href', '/media/episode-1');
  });
});

describe('ViolationDetail map', () => {
  it('merges sessions in one city with different coordinates into one location', async () => {
    const inCity = {
      geoCity: 'Austin',
      geoRegion: 'Texas',
      geoCountry: 'US',
      isLocal: false,
    };
    current = {
      ...violation,
      session: { ...violation.session, ...inCity, geoLat: 30.27, geoLon: -97.74 },
      relatedSessions: [
        { ...violation.session, ...inCity, id: 'sess-2', geoLat: 30.31, geoLon: -97.7 },
      ],
    } as unknown as ViolationWithDetails;
    renderPage();

    await vi.waitFor(() => expect(mapProps.locations).toHaveLength(1));
    expect(mapProps.locations[0]).toMatchObject({
      city: 'Austin',
      count: 2,
      lat: 30.27,
      lon: -97.74,
    });
  });
});
