import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ResolutionDistributionSection } from './ResolutionDistributionSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseLibraryResolution = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({ useLibraryResolution: mockUseLibraryResolution }));
vi.mock('@/components/server', () => ({ PerServerCardGrid: () => null }));

interface ChartOptions {
  series: { name: string }[];
  tooltip: { formatter: (this: { key: string; y: number }) => string };
}
const chartOptions = vi.hoisted(() => [] as ChartOptions[]);
vi.mock('highcharts-react-official', () => ({
  HighchartsReact: ({ options }: { options: ChartOptions }) => {
    chartOptions.push(options);
    return <div data-testid="chart" />;
  },
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <ResolutionDistributionSection serverId="srv-1" />
    </MemoryRouter>
  );
}

describe('ResolutionDistributionSection', () => {
  beforeEach(() => {
    chartOptions.length = 0;
  });

  it('titles the cards, counts and chart text from translations', () => {
    mockUseLibraryResolution.mockReturnValue({
      isLoading: false,
      data: { movies: { counts: { '1080p': 3 }, total: 3 }, tv: { counts: {}, total: 0 } },
    });
    renderSection();

    expect(screen.getByText('common:media.movie_plural')).toBeInTheDocument();
    expect(screen.getByText('common:media.tvShows')).toBeInTheDocument();
    expect(screen.getAllByText('library.quality.resolution.itemCount')).toHaveLength(2);
    expect(chartOptions[0]?.series[0]?.name).toBe('common:labels.quality');
    expect(chartOptions[0]?.tooltip.formatter.call({ key: '1080p', y: 3 })).toBe(
      'library.quality.resolution.tooltip'
    );
  });

  it('explains a type with no resolution data from translations', () => {
    mockUseLibraryResolution.mockReturnValue({
      isLoading: false,
      data: { movies: { counts: {}, total: 0 }, tv: { counts: {}, total: 0 } },
    });
    renderSection();

    expect(screen.getAllByText('common:empty.noData')).toHaveLength(2);
    expect(screen.getAllByText('library.quality.resolution.empty')).toHaveLength(2);
  });
});
