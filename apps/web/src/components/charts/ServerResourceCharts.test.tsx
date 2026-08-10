import { act, render } from '@testing-library/react';
import type Highcharts from 'highcharts';
import { describe, expect, it, vi } from 'vitest';
import { ServerResourceCharts, type ResourceMultiSeries } from './ServerResourceCharts';

const chartOptions = vi.hoisted(() => ({ values: [] as Highcharts.Options[] }));

interface TestSeries {
  id?: string;
  visible?: boolean;
  data?: unknown[];
}

vi.mock('highcharts', () => ({ default: {} }));

vi.mock('highcharts-react-official', () => ({
  HighchartsReact: ({ options }: { options: Highcharts.Options }) => {
    chartOptions.values.push(options);
    return <div data-testid="highcharts" />;
  },
}));

const data: ResourceMultiSeries[] = [
  {
    serverId: 'jellyfin',
    serverName: 'Jellyfin',
    color: '#a855f7',
    data: [
      {
        at: 100,
        timespan: 6,
        hostCpuUtilization: 10,
        processCpuUtilization: 1,
        hostMemoryUtilization: 40,
        processMemoryUtilization: 2,
      },
    ],
  },
  {
    serverId: 'dispatcharr',
    serverName: 'Dispatcharr',
    color: '#14b8a6',
    data: [
      {
        at: 100,
        timespan: 6,
        hostCpuUtilization: 20,
        processCpuUtilization: 3,
        hostMemoryUtilization: 30,
        processMemoryUtilization: 4,
      },
    ],
  },
];

function latestCpuOptions() {
  const matching = chartOptions.values
    .filter((options) => {
      const series = options.series as TestSeries[] | undefined;
      const firstPoint = series?.[0]?.data?.[0];
      return Array.isArray(firstPoint) && firstPoint[1] === 10;
    });
  return matching[matching.length - 1];
}

describe('ServerResourceCharts', () => {
  it('keeps a legend selection controlled across live-data updates', () => {
    chartOptions.values = [];
    const view = render(<ServerResourceCharts data={undefined} multiSeries={data} />);

    const initial = latestCpuOptions();
    const initialSeries = initial?.series as TestSeries[] | undefined;
    expect(initialSeries?.map((series: TestSeries) => series.id)).toEqual(['jellyfin', 'dispatcharr']);
    expect(initialSeries?.map((series: TestSeries) => series.visible)).toEqual([true, true]);

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- tests the Highcharts legend callback used by the chart.
    const onLegendClick = initial?.plotOptions?.series?.events?.legendItemClick;
    expect(onLegendClick).toBeTypeOf('function');
    act(() => {
      (onLegendClick as unknown as (this: Highcharts.Series) => boolean).call({
        options: { id: 'jellyfin' },
      } as Highcharts.Series);
    });

    const hiddenSeries = latestCpuOptions()?.series as TestSeries[] | undefined;
    expect(hiddenSeries?.map((series: TestSeries) => series.visible)).toEqual([false, true]);

    const jellyfin = data[0]!;
    const dispatcharr = data[1]!;

    view.rerender(
      <ServerResourceCharts
        data={undefined}
        multiSeries={[
          {
            ...jellyfin,
            data: [{ ...jellyfin.data[0]!, at: 106, hostCpuUtilization: 10 }],
          },
          {
            ...dispatcharr,
            data: [{ ...dispatcharr.data[0]!, at: 106, hostCpuUtilization: 20 }],
          },
        ]}
      />
    );

    const refreshedSeries = latestCpuOptions()?.series as TestSeries[] | undefined;
    expect(refreshedSeries?.map((series: TestSeries) => series.id)).toEqual(['jellyfin', 'dispatcharr']);
    expect(refreshedSeries?.map((series: TestSeries) => series.visible)).toEqual([false, true]);
  });
});
