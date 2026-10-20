import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type Highcharts from 'highcharts';
import type { HourOfDayStats, PlaysMediaGroup } from '@tracearr/shared';
import { HourOfDayChart } from './HourOfDayChart';

const { renderedOptions } = vi.hoisted(() => ({ renderedOptions: [] as Highcharts.Options[] }));

vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts-react-official', () => ({
  HighchartsReact: ({ options }: { options: Highcharts.Options }) => {
    renderedOptions.push(options);
    return null;
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/timeFormat', () => ({ getHour12: () => false }));

function day(mediaType: PlaysMediaGroup, plays: Record<number, number>): HourOfDayStats[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: plays[hour] ?? 0, mediaType }));
}

function lastOptions() {
  return renderedOptions[renderedOptions.length - 1];
}

describe('HourOfDayChart', () => {
  beforeEach(() => {
    renderedOptions.length = 0;
  });

  it('stacks movies, TV shows and music in that order when every type has plays', () => {
    render(
      <HourOfDayChart
        data={[...day('movie', { 21: 3 }), ...day('show', { 20: 2 }), ...day('music', { 8: 5 })]}
      />
    );

    const series = lastOptions()?.series ?? [];
    expect(series.map((s) => s.name)).toEqual([
      'common:media.movie_plural',
      'common:media.tvShows',
      'common:media.music',
    ]);
    expect(series[2]).toMatchObject({ type: 'column', stacking: 'normal' });
    expect((series[2] as Highcharts.SeriesColumnOptions).data?.[8]).toEqual([8, 5]);
  });

  it('draws one series of plays and hides the legend when the rows carry no media type', () => {
    render(<HourOfDayChart data={Array.from({ length: 24 }, (_, hour) => ({ hour, count: 1 }))} />);

    expect(lastOptions()?.series).toEqual([
      expect.objectContaining({ type: 'column', name: 'labels.plays' }),
    ]);
    expect(lastOptions()?.legend?.enabled).toBe(false);
  });
});
