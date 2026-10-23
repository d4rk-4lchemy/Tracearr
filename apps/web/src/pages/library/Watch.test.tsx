import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LibraryWatch } from './Watch';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const mockUseLibraryWatch = vi.hoisted(() => vi.fn());
const mockUseLibraryPatterns = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({
  useLibraryWatch: mockUseLibraryWatch,
  useLibraryPatterns: mockUseLibraryPatterns,
}));

const serverState = vi.hoisted(() => ({
  mediaLibraryServerIds: ['srv-1'],
  mediaLibraryServers: [{ id: 'srv-1', name: 'Den' }],
  isLoading: false,
}));
vi.mock('@/hooks/useServer', () => ({ useServer: () => serverState }));

const customRange = vi.hoisted(() => ({
  period: 'custom' as const,
  startDate: new Date(2026, 8, 1),
  endDate: new Date(2026, 8, 10),
}));
vi.mock('@/hooks/useTimeRange', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTimeRange')>()),
  useTimeRange: () => ({ value: customRange }),
}));

vi.mock('@/lib/dateFormat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateFormat')>()),
  weekdayName: (day: number, width: string) => `${width}-day-${day}`,
}));

vi.mock('@/components/library', () => ({
  ErrorState: () => null,
  BingeHighlightsTable: () => null,
  MostWatchedSection: () => <div data-testid="most-watched" />,
}));
vi.mock('@/components/charts', () => ({
  CompletionDonutChart: () => null,
  HourlyDistributionChart: () => null,
  MonthlyTrendChart: () => null,
}));
vi.mock('@/components/server', () => ({ PerServerCardGrid: () => null }));

const counts = { completed: 0, inProgress: 0, notStarted: 0 };

function watchResponse(totalItems: number) {
  return {
    data: {
      summary: {
        totalItems,
        watchedCount: 0,
        watchedPct: 0,
        totalWatchMs: 0,
        avgPlaysPerItem: 0,
        completion: { movie: counts, episode: counts },
      },
    },
    isLoading: false,
    isError: false,
  };
}

describe('LibraryWatch', () => {
  beforeEach(() => {
    serverState.mediaLibraryServerIds = ['srv-1'];
    serverState.mediaLibraryServers = [{ id: 'srv-1', name: 'Den' }];
    mockUseLibraryWatch.mockReset();
    mockUseLibraryPatterns.mockReset();
    mockUseLibraryPatterns.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('keeps Dispatcharr-only selections out of library queries', () => {
    serverState.mediaLibraryServerIds = [];
    serverState.mediaLibraryServers = [];
    mockUseLibraryWatch.mockReturnValue(watchResponse(0));

    render(<LibraryWatch />);

    expect(screen.getByText('media.noLibraryServers')).toBeInTheDocument();
    expect(mockUseLibraryWatch).toHaveBeenCalledWith([], null, expect.any(Object));
    expect(mockUseLibraryPatterns).toHaveBeenCalledWith([], null, expect.any(Object));
  });

  it('passes the page range to watch and patterns', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(10));
    render(<LibraryWatch />);
    const range = {
      period: '30d',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-11T00:00:00.000Z',
    };
    expect(mockUseLibraryWatch).toHaveBeenCalledWith(['srv-1'], null, range);
    expect(mockUseLibraryPatterns).toHaveBeenCalledWith(['srv-1'], null, range);
  });

  it('keeps Most Watched and patterns visible when the range has no plays', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(10));
    render(<LibraryWatch />);
    expect(screen.getByTestId('most-watched')).toBeInTheDocument();
    expect(screen.getByText('library.watch.viewingHours')).toBeInTheDocument();
    expect(screen.queryByText('library.watch.noData')).not.toBeInTheDocument();
  });

  it('shows the page empty state only when the library has no titles', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(0));
    render(<LibraryWatch />);
    expect(screen.getByText('library.watch.noData')).toBeInTheDocument();
    expect(screen.queryByTestId('most-watched')).not.toBeInTheDocument();
  });

  it('hides the peak hour and its badge when the range has no plays', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(10));
    const hours = (watchCount: number) =>
      Array.from({ length: 24 }, (_, hour) => ({
        hour,
        watchCount: hour === 20 ? watchCount : 0,
        totalWatchMs: 0,
        pctOfTotal: 0,
      }));
    const patterns = (watchCount: number) => ({
      data: {
        peakTimes: {
          hourlyDistribution: hours(watchCount),
          peakHour: watchCount ? 20 : 0,
          peakDayOfWeek: watchCount ? 5 : 0,
        },
        trend: { bucket: 'day', points: [], busiest: null, quietest: null },
      },
      isLoading: false,
      isError: false,
    });

    mockUseLibraryPatterns.mockReturnValue(patterns(0));
    const { unmount } = render(<LibraryWatch />);
    expect(screen.queryByText(/library.watch.peak /)).not.toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    unmount();

    mockUseLibraryPatterns.mockReturnValue(patterns(3));
    render(<LibraryWatch />);
    expect(screen.getByText(/library.watch.peak /)).toBeInTheDocument();
  });

  it('shows the busiest and quietest badges only when the range has plays', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(10));
    const trend = (busiest: string | null, quietest: string | null) => ({
      data: {
        peakTimes: { hourlyDistribution: [], peakHour: 20, peakDayOfWeek: 5 },
        trend: { bucket: 'day', points: [], busiest, quietest },
      },
      isLoading: false,
      isError: false,
    });

    mockUseLibraryPatterns.mockReturnValue(trend(null, null));
    const { unmount } = render(<LibraryWatch />);
    expect(screen.queryByText(/library.watch.busiest/)).not.toBeInTheDocument();
    unmount();

    mockUseLibraryPatterns.mockReturnValue(trend('2026-09-03', '2026-09-05'));
    render(<LibraryWatch />);
    expect(screen.getByText(/library.watch.busiest/)).toBeInTheDocument();
    expect(screen.getByText(/library.watch.quietest/)).toBeInTheDocument();
  });

  it('names the peak day with the formatting locale weekday name', () => {
    mockUseLibraryWatch.mockReturnValue(watchResponse(10));
    mockUseLibraryPatterns.mockReturnValue({
      data: {
        peakTimes: {
          hourlyDistribution: [{ hour: 20, watchCount: 3, totalWatchMs: 0, pctOfTotal: 0 }],
          peakHour: 20,
          peakDayOfWeek: 5,
        },
        trend: { bucket: 'day', points: [], busiest: null, quietest: null },
      },
      isLoading: false,
      isError: false,
    });
    render(<LibraryWatch />);
    expect(screen.getByText(/long-day-5/)).toBeInTheDocument();
  });
});
