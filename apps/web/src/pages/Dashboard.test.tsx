import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Dashboard } from './Dashboard';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/queries', () => ({
  useDashboardStats: vi.fn(),
  useActiveSessions: vi.fn(),
}));

// Not typechecked against the real module - keep in sync by hand
vi.mock('@/hooks/queries/useServers', () => ({
  useServerLiveStats: vi.fn(),
  useMultiServerLiveStats: vi.fn(),
}));

vi.mock('@/components/charts/ServerResourceCharts', () => ({
  ServerResourceCharts: () => null,
}));

vi.mock('@/components/charts/BandwidthChart', () => ({
  ServerBandwidthChart: vi.fn(() => null),
}));

vi.mock('@/components/history/SessionDetailSheet', () => ({
  SessionDetailSheet: () => null,
}));

vi.mock('@/components/map/StreamCard', () => ({
  StreamCard: () => null,
}));

vi.mock('@/components/sessions', () => ({
  NowPlayingCard: () => null,
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ isConnected: true }),
}));

vi.mock('@/hooks/useServerColorMap', () => ({
  useServerColorMap: () => new Map(),
}));

import { useDashboardStats, useActiveSessions } from '@/hooks/queries';
import { useServerLiveStats, useMultiServerLiveStats } from '@/hooks/queries/useServers';
import { useServer } from '@/hooks/useServer';
import { ServerBandwidthChart } from '@/components/charts/BandwidthChart';

const mockUseDashboardStats = vi.mocked(useDashboardStats);
const mockUseActiveSessions = vi.mocked(useActiveSessions);
const mockUseServerLiveStats = vi.mocked(useServerLiveStats);
const mockUseMultiServerLiveStats = vi.mocked(useMultiServerLiveStats);
const mockUseServer = vi.mocked(useServer);
const mockServerBandwidthChart = vi.mocked(ServerBandwidthChart);

function serverReturn() {
  return {
    selectedServerIds: [],
    selectedServers: [],
    isMultiServer: false,
    selectedServerId: null,
  } as unknown as ReturnType<typeof useServer>;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServer.mockReturnValue(serverReturn());
    mockUseServerLiveStats.mockReturnValue({
      statistics: undefined,
      statisticsAverages: null,
      bandwidth: undefined,
      bandwidthAverages: null,
      clockSkewMs: 0,
      isLoading: false,
    } as unknown as ReturnType<typeof useServerLiveStats>);
    mockUseMultiServerLiveStats.mockReturnValue({
      series: [],
      clockSkewMs: 0,
      isLoading: false,
    });
  });

  it('shows Now Playing skeletons (not the empty-streams card) while sessions are still loading', () => {
    mockUseDashboardStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardStats>);
    mockUseActiveSessions.mockReturnValue({
      data: undefined,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useActiveSessions>);

    renderDashboard();

    expect(screen.queryByText('dashboard.noActiveStreams')).not.toBeInTheDocument();
    // The skeleton grid renders three placeholder cards while sessions are undefined.
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows the no-active-streams empty state once sessions have loaded and there are none', () => {
    mockUseDashboardStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardStats>);
    mockUseActiveSessions.mockReturnValue({
      data: [],
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useActiveSessions>);

    renderDashboard();

    expect(screen.getByText('dashboard.noActiveStreams')).toBeInTheDocument();
  });

  it('shows TV channel count as the TV Sessions sublabel', () => {
    mockUseDashboardStats.mockReturnValue({
      data: {
        activeStreams: 0,
        todayPlays: 1,
        todaySessions: 1,
        watchTimeHours: 1,
        tvSessions: 5,
        tvChannels: 3,
        tvWatchTimeHours: 2.5,
        alertsLast24h: 0,
        activeUsersToday: 2,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardStats>);
    mockUseActiveSessions.mockReturnValue({
      data: [],
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useActiveSessions>);

    renderDashboard();

    expect(screen.getByText(/common:count.channel/)).toBeInTheDocument();
  });

  it('renders Dispatcharr bandwidth only after a valid zero-valued sample arrives', () => {
    mockUseServer.mockReturnValue({
      selectedServerIds: ['dispatcharr-1'],
      selectedServers: [{ id: 'dispatcharr-1', type: 'dispatcharr', name: 'Dispatcharr' }],
      isMultiServer: false,
      selectedServerId: 'dispatcharr-1',
    } as unknown as ReturnType<typeof useServer>);
    mockUseServerLiveStats.mockReturnValue({
      statistics: [],
      statisticsAverages: null,
      bandwidth: [],
      bandwidthAverages: null,
      clockSkewMs: 0,
      isLoading: false,
    } as unknown as ReturnType<typeof useServerLiveStats>);

    const first = renderDashboard();
    expect(mockServerBandwidthChart).not.toHaveBeenCalled();
    first.unmount();

    const sample = { at: 100, timespan: 6, lanBytes: 0, wanBytes: 0 };
    mockUseServerLiveStats.mockReturnValue({
      statistics: [],
      statisticsAverages: null,
      bandwidth: [sample],
      bandwidthAverages: { local: 0, remote: 0 },
      clockSkewMs: 0,
      isLoading: false,
    } as unknown as ReturnType<typeof useServerLiveStats>);

    renderDashboard();
    expect(mockServerBandwidthChart).toHaveBeenCalledWith(
      expect.objectContaining({ data: [sample] }),
      undefined
    );
  });

  it('shows a page-level error state when the stats query fails, and retry refetches both queries', async () => {
    const refetchStats = vi.fn();
    const refetchSessions = vi.fn();
    mockUseDashboardStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('stats failed'),
      refetch: refetchStats,
    } as unknown as ReturnType<typeof useDashboardStats>);
    mockUseActiveSessions.mockReturnValue({
      data: undefined,
      isError: false,
      error: null,
      refetch: refetchSessions,
    } as unknown as ReturnType<typeof useActiveSessions>);

    renderDashboard();

    expect(screen.getByText('common:errors.somethingWentWrong')).toBeInTheDocument();
    expect(screen.getByText('stats failed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetchStats).toHaveBeenCalled();
    expect(refetchSessions).toHaveBeenCalled();
  });
});
