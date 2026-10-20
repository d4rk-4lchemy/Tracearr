import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type Highcharts from 'highcharts';
import { PlaysChart } from './PlaysChart';

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

const data = [
  { date: '2026-10-01', count: 3 },
  { date: '2026-10-02', count: 5 },
];

function lastSeries() {
  return renderedOptions[renderedOptions.length - 1]?.series ?? [];
}

describe('PlaysChart', () => {
  beforeEach(() => {
    renderedOptions.length = 0;
  });

  it('renders one area series when no comparisons are given', () => {
    render(<PlaysChart data={data} />);

    expect(lastSeries()).toEqual([expect.objectContaining({ type: 'area', name: 'labels.plays' })]);
  });

  it('adds each comparison as a line series after the main area series', () => {
    render(
      <PlaysChart
        data={data}
        comparisons={[
          { name: 'Prior', data, dashStyle: 'ShortDash', color: 'grey' },
          { name: 'Average', data },
        ]}
      />
    );

    const series = lastSeries();
    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ type: 'area' });
    expect(series[1]).toMatchObject({
      type: 'line',
      name: 'Prior',
      dashStyle: 'ShortDash',
      color: 'grey',
    });
    expect(series[2]).toMatchObject({ type: 'line', name: 'Average', dashStyle: 'Solid' });
    expect(renderedOptions[renderedOptions.length - 1]?.legend?.enabled).toBe(true);
  });

  it('keeps the stacked per-server series for multi-server callers', () => {
    render(
      <PlaysChart
        data={[{ date: '2026-10-01', count: 3, serverId: 'a' }]}
        isMultiServer
        servers={[{ id: 'a', name: 'A', color: null }]}
      />
    );

    expect(lastSeries()).toEqual([
      expect.objectContaining({ type: 'area', stacking: 'normal', name: 'A' }),
    ]);
  });

  it('stacks one area per media type, movies before TV shows, and leaves out music with no plays', () => {
    render(
      <PlaysChart
        stackBy="mediaType"
        data={[
          { date: '2026-10-12', count: 2, serverId: 'a', mediaType: 'movie' },
          { date: '2026-10-12', count: 1, serverId: 'b', mediaType: 'movie' },
          { date: '2026-10-12', count: 3, serverId: 'a', mediaType: 'show' },
          { date: '2026-10-13', count: 1, serverId: 'a', mediaType: 'show' },
          { date: '2026-10-13', count: 0, serverId: 'a', mediaType: 'music' },
        ]}
      />
    );

    const oct12 = new Date('2026-10-12T00:00:00').getTime();
    const oct13 = new Date('2026-10-13T00:00:00').getTime();
    expect(lastSeries()).toEqual([
      expect.objectContaining({
        type: 'area',
        stacking: 'normal',
        name: 'common:media.movie_plural',
        data: [
          [oct12, 3],
          [oct13, 0],
        ],
      }),
      expect.objectContaining({
        type: 'area',
        stacking: 'normal',
        name: 'common:media.tvShows',
        data: [
          [oct12, 3],
          [oct13, 1],
        ],
      }),
    ]);
    expect(renderedOptions[renderedOptions.length - 1]?.legend?.enabled).toBe(true);
  });

  it('shows Live TV as its own series instead of music', () => {
    render(
      <PlaysChart
        stackBy="mediaType"
        data={[{ date: '2026-10-12', count: 4, serverId: 'dispatcharr', mediaType: 'live' }]}
      />
    );
    expect(lastSeries()).toEqual([
      expect.objectContaining({ type: 'area', name: 'common:media.liveTV' }),
    ]);
  });

  it('keeps comparisons over a single media type, with the legend for the comparison', () => {
    render(
      <PlaysChart
        stackBy="mediaType"
        data={[{ date: '2026-10-12', count: 2, serverId: 'a', mediaType: 'show' }]}
        comparisons={[{ name: 'Prior', data: [{ date: '2026-10-12', count: 1 }] }]}
      />
    );

    expect(lastSeries()).toEqual([
      expect.objectContaining({ type: 'area', name: 'common:media.tvShows' }),
      expect.objectContaining({ type: 'line', name: 'Prior' }),
    ]);
    expect(renderedOptions[renderedOptions.length - 1]?.legend?.enabled).toBe(true);
  });

  it('shows the translated empty message without data', () => {
    const { getByText } = render(<PlaysChart data={[]} />);

    expect(getByText('empty.noPlayData')).toBeInTheDocument();
  });
});
