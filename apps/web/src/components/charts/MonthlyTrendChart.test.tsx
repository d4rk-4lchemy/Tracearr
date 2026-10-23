import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthlyTrendChart } from './MonthlyTrendChart';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('highcharts-react-official', () => ({
  HighchartsReact: () => <div data-testid="chart" />,
}));

const points = (counts: number[]) =>
  counts.map((watchCount, i) => ({
    start: `2026-09-0${i + 1}`,
    watchCount,
    totalWatchHours: 0,
  }));

describe('MonthlyTrendChart', () => {
  it('shows the empty state when every bucket is zero', () => {
    render(
      <MonthlyTrendChart
        trend={{ bucket: 'day', points: points([0, 0, 0]), busiest: null, quietest: null }}
      />
    );
    expect(screen.getByText('library.charts.monthly.empty.title')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('draws the chart when any bucket has plays', () => {
    render(
      <MonthlyTrendChart
        trend={{
          bucket: 'day',
          points: points([0, 2, 0]),
          busiest: '2026-09-02',
          quietest: '2026-09-01',
        }}
      />
    );
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });
});
