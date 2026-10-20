import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { History } from './History';
import type { HistoryFilters } from '@/hooks/queries';
import type { TimeRangeValue } from '@/components/ui/time-range-picker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const queries = vi.hoisted(() => ({
  useHistorySessions: vi.fn((_filters: unknown) => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  })),
  useHistoryAggregates: vi.fn((_filters: unknown) => ({
    isLoading: false,
    isFetching: false,
    isError: false,
  })),
}));

vi.mock('@/hooks/queries', () => ({
  useHistorySessions: queries.useHistorySessions,
  useHistoryAggregates: queries.useHistoryAggregates,
  useFilterOptions: () => ({ data: undefined, isLoading: false }),
  useSession: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }));
vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ selectedServerIds: [], isMultiServer: false }),
}));

const bar = vi.hoisted(() => ({
  props: null as null | {
    filters: HistoryFilters;
    onFiltersChange: (filters: HistoryFilters) => void;
    onTimeRangeChange: (range: TimeRangeValue) => void;
  },
}));

vi.mock('@/components/history/HistoryFilters', () => ({
  HistoryFiltersBar: (props: NonNullable<typeof bar.props>) => {
    bar.props = props;
    return null;
  },
  DEFAULT_COLUMN_VISIBILITY: {},
}));
const table = vi.hoisted(() => ({
  onSortChange: null as null | ((column: 'startedAt' | 'durationMs' | 'mediaTitle') => void),
}));

vi.mock('@/components/history/HistoryTable', () => ({
  HistoryTable: (props: { onSortChange: NonNullable<typeof table.onSortChange> }) => {
    table.onSortChange = props.onSortChange;
    return null;
  },
}));
vi.mock('@/components/history/HistoryAggregates', () => ({ HistoryAggregates: () => null }));
vi.mock('@/components/history/SessionDetailSheet', () => ({ SessionDetailSheet: () => null }));

function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <History />
      <LocationProbe />
    </MemoryRouter>
  );
}

function writtenParams(view: ReturnType<typeof render>) {
  return new URLSearchParams(view.getByTestId('search').textContent ?? '');
}

function queriedWindowDays(url: string): number {
  queries.useHistorySessions.mockClear();
  render(
    <MemoryRouter initialEntries={[url]}>
      <History />
    </MemoryRouter>
  );
  const filters = queries.useHistorySessions.mock.calls[0]?.[0] as HistoryFilters;
  return Math.round((filters.endDate!.getTime() - filters.startDate!.getTime()) / 86_400_000);
}

describe('History date window', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to 30 days with no period in the URL', () => {
    expect(queriedWindowDays('/history')).toBe(30);
  });

  it('queries a 7-day window when the sidebar carries period=week', () => {
    expect(queriedWindowDays('/history?period=week')).toBe(7);
  });

  it('uses the custom range dates', () => {
    expect(queriedWindowDays('/history?period=custom&from=2026-10-01&to=2026-10-11')).toBe(10);
  });

  it('leaves the window open for period=all', () => {
    queries.useHistorySessions.mockClear();
    render(
      <MemoryRouter initialEntries={['/history?period=all']}>
        <History />
      </MemoryRouter>
    );
    const filters = queries.useHistorySessions.mock.calls[0]?.[0] as HistoryFilters;
    expect(filters.startDate).toBeUndefined();
  });

  it('ignores the old startDate and endDate params', () => {
    const url =
      '/history?period=week&startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-21T00:00:00.000Z';
    expect(queriedWindowDays(url)).toBe(7);
  });
});

describe('History URL params', () => {
  it('writes period, from and to for a custom range and nothing else for dates', () => {
    const view = renderAt('/history?search=alice');

    act(() =>
      bar.props?.onTimeRangeChange({
        period: 'custom',
        startDate: new Date(2026, 9, 1),
        endDate: new Date(2026, 9, 11),
      })
    );

    const params = writtenParams(view);
    expect(params.get('period')).toBe('custom');
    expect(params.get('from')).toBe('2026-10-01');
    expect(params.get('to')).toBe('2026-10-11');
    expect(params.get('search')).toBe('alice');
    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
  });

  it('keeps the range params when another filter changes', () => {
    const view = renderAt('/history?period=custom&from=2026-10-01&to=2026-10-11');

    act(() => bar.props?.onFiltersChange({ ...bar.props.filters, search: 'alice' }));

    const params = writtenParams(view);
    expect(params.get('period')).toBe('custom');
    expect(params.get('from')).toBe('2026-10-01');
    expect(params.get('to')).toBe('2026-10-11');
    expect(params.get('search')).toBe('alice');
    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
  });

  it('writes period=all when the filters carry no window', () => {
    const view = renderAt('/history?period=custom&from=2026-10-01&to=2026-10-11');

    act(() => bar.props?.onFiltersChange({}));

    const params = writtenParams(view);
    expect(params.get('period')).toBe('all');
    expect(params.has('from')).toBe(false);
  });
});

describe('History aggregates', () => {
  it('keeps the aggregates query key when the sort changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
      queries.useHistoryAggregates.mockClear();
      renderAt('/history?period=week');
      const before = queries.useHistoryAggregates.mock.lastCall?.[0];

      vi.setSystemTime(new Date('2026-10-18T12:05:00Z'));
      act(() => table.onSortChange?.('durationMs'));

      expect(queries.useHistorySessions.mock.lastCall?.[0]).toMatchObject({
        orderBy: 'durationMs',
      });
      expect(queries.useHistoryAggregates.mock.lastCall?.[0]).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
