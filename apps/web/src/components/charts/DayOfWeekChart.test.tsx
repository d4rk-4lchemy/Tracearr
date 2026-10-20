import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type Highcharts from 'highcharts';
import type { DayOfWeekStats, PlaysMediaGroup } from '@tracearr/shared';
import { DayOfWeekChart } from './DayOfWeekChart';

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function week(mediaType: PlaysMediaGroup, counts: number[]): DayOfWeekStats[] {
  return DAYS.map((name, day) => ({ day, name, count: counts[day] ?? 0, mediaType }));
}

function lastOptions() {
  return renderedOptions[renderedOptions.length - 1];
}

describe('DayOfWeekChart', () => {
  beforeEach(() => {
    renderedOptions.length = 0;
  });

  it('stacks a column series per media type and leaves out a type with no plays', () => {
    render(
      <DayOfWeekChart
        data={[
          ...week('movie', [1, 0, 0, 0, 0, 2, 3]),
          ...week('show', [0, 4, 0, 0, 0, 1, 0]),
          ...week('music', [0, 0, 0, 0, 0, 0, 0]),
        ]}
      />
    );

    expect(lastOptions()?.xAxis).toMatchObject({ categories: DAYS });
    expect(lastOptions()?.series).toEqual([
      expect.objectContaining({
        type: 'column',
        stacking: 'normal',
        name: 'common:media.movie_plural',
        data: [
          [0, 1],
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
          [5, 2],
          [6, 3],
        ],
      }),
      expect.objectContaining({ type: 'column', name: 'common:media.tvShows' }),
    ]);
    expect(lastOptions()?.legend?.enabled).toBe(true);
  });

  it('draws one series of plays when the rows carry no media type', () => {
    render(<DayOfWeekChart data={DAYS.map((name, day) => ({ day, name, count: day }))} />);

    expect(lastOptions()?.series).toEqual([
      expect.objectContaining({
        type: 'column',
        name: 'labels.plays',
        data: [0, 1, 2, 3, 4, 5, 6],
      }),
    ]);
    expect(lastOptions()?.legend?.enabled).toBe(false);
  });
});
