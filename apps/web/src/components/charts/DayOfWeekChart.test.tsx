import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type Highcharts from 'highcharts';
import type { DayOfWeekStats, PlaysMediaGroup } from '@tracearr/shared';
import { getWeekStart, weekdayName } from '@/lib/dateFormat';
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

vi.mock('@/lib/dateFormat', () => ({
  getWeekStart: vi.fn(),
  orderedWeekdays: () => {
    const start = vi.mocked(getWeekStart)();
    return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
  },
  weekdayName: vi.fn(),
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
    vi.mocked(getWeekStart).mockReturnValue(0);
    vi.mocked(weekdayName).mockImplementation((day) => DAYS[day] ?? '');
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

  it('starts the week on Monday when the preference says so', () => {
    vi.mocked(getWeekStart).mockReturnValue(1);
    render(<DayOfWeekChart data={DAYS.map((name, day) => ({ day, name, count: 10 + day }))} />);

    expect(lastOptions()?.xAxis).toMatchObject({
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    });
    expect(lastOptions()?.series).toEqual([
      expect.objectContaining({ data: [11, 12, 13, 14, 15, 16, 10] }),
    ]);
  });

  it('starts on Saturday and keeps stacked media series aligned', () => {
    vi.mocked(getWeekStart).mockReturnValue(6);
    render(
      <DayOfWeekChart
        data={[
          ...week('movie', [1, 2, 3, 4, 5, 6, 7]),
          ...week('show', [10, 20, 30, 40, 50, 60, 70]),
        ]}
      />
    );

    expect(lastOptions()?.xAxis).toMatchObject({
      categories: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    });
    expect(lastOptions()?.series).toEqual([
      expect.objectContaining({
        data: [
          [0, 7],
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 4],
          [5, 5],
          [6, 6],
        ],
      }),
      expect.objectContaining({
        data: [
          [0, 70],
          [1, 10],
          [2, 20],
          [3, 30],
          [4, 40],
          [5, 50],
          [6, 60],
        ],
      }),
    ]);
  });

  it('names days in the formatting locale instead of the server name', () => {
    vi.mocked(weekdayName).mockImplementation((day) => (day === 0 ? 'So.' : (DAYS[day] ?? '')));
    render(<DayOfWeekChart data={DAYS.map((name, day) => ({ day, name, count: day }))} />);

    expect(lastOptions()?.xAxis).toMatchObject({
      categories: ['So.', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    });
  });
});
