import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ViolationWithDetails } from '@tracearr/shared';
import { ViolationDetail } from './ViolationDetail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServerColorMap', () => ({ useServerColorMap: () => new Map() }));

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

vi.mock('@/hooks/queries', () => ({
  useViolation: () => ({ data: violation, isLoading: false }),
  useSettings: () => ({ data: undefined }),
  useAcknowledgeViolation: () => ({ mutate: vi.fn(), isPending: false }),
  useDismissViolation: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('ViolationDetail sessions table', () => {
  it('links the show and the episode to their media pages', () => {
    render(
      <MemoryRouter initialEntries={['/violations/v-1']}>
        <Routes>
          <Route path="/violations/:id" element={<ViolationDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Lost' })).toHaveAttribute('href', '/media/show-1');
    expect(screen.getByRole('link', { name: /Pilot/ })).toHaveAttribute('href', '/media/episode-1');
  });
});
