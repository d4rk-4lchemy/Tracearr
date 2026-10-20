import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MostWatchedSection } from './MostWatchedSection';
import type { TimeRangeValue } from '@/components/ui/time-range-picker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseTopMovies = vi.hoisted(() => vi.fn());
const mockUseTopShows = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({
  useTopMovies: mockUseTopMovies,
  useTopShows: mockUseTopShows,
}));

vi.mock('./TopMoviesTable', () => ({ TopMoviesTable: () => null }));
vi.mock('./TopShowsTable', () => ({ TopShowsTable: () => null }));

const query = { data: undefined, isLoading: false };

function renderSection(timeRange: TimeRangeValue) {
  return (
    <MostWatchedSection
      serverIds={['srv-1']}
      selectedServers={[]}
      isMultiServer={false}
      timeRange={timeRange}
    />
  );
}

describe('MostWatchedSection', () => {
  beforeEach(() => {
    mockUseTopMovies.mockReturnValue(query);
    mockUseTopShows.mockReturnValue(query);
  });

  it('queries the period of the time range it is given', () => {
    const { rerender } = render(renderSection({ period: 'month' }));
    expect(mockUseTopMovies).toHaveBeenLastCalledWith(
      ['srv-1'],
      '30d',
      'plays',
      'desc',
      1,
      10,
      undefined,
      undefined
    );

    rerender(renderSection({ period: 'week' }));
    expect(mockUseTopMovies).toHaveBeenLastCalledWith(
      ['srv-1'],
      '7d',
      'plays',
      'desc',
      1,
      10,
      undefined,
      undefined
    );
    expect(mockUseTopShows).toHaveBeenLastCalledWith(
      ['srv-1'],
      '7d',
      'plays',
      'desc',
      1,
      10,
      undefined,
      undefined
    );
  });

  it('passes a custom range to both queries as its start and end', () => {
    render(
      renderSection({
        period: 'custom',
        startDate: new Date(2026, 2, 2),
        endDate: new Date(2026, 2, 5),
      })
    );
    const start = '2026-03-02T00:00:00.000Z';
    const end = '2026-03-06T00:00:00.000Z';
    expect(mockUseTopMovies).toHaveBeenLastCalledWith(
      ['srv-1'],
      '30d',
      'plays',
      'desc',
      1,
      10,
      start,
      end
    );
    expect(mockUseTopShows).toHaveBeenLastCalledWith(
      ['srv-1'],
      '30d',
      'plays',
      'desc',
      1,
      10,
      start,
      end
    );
  });

  it('labels the card and tabs from translations', () => {
    render(renderSection({ period: 'month' }));
    expect(screen.getByText('library.watch.mostWatched')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'common:media.movie_plural' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'common:media.tvShows' })).toBeInTheDocument();
  });
});
