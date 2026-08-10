import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HighchartsLibrary from 'highcharts';
import type Highcharts from 'highcharts';
import { describe, expect, it, vi } from 'vitest';
import { ServerResourceCharts, type ResourceMultiSeries } from './ServerResourceCharts';

const initialData: ResourceMultiSeries[] = [
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

function chartsIn(container: HTMLElement) {
  return HighchartsLibrary.charts.filter(
    (chart): chart is Highcharts.Chart => Boolean(chart?.container && container.contains(chart.container))
  );
}

function seriesById(chart: Highcharts.Chart, id: string) {
  return chart.series.find((series) => series.options.id === id);
}

function firstDataValue(chart: Highcharts.Chart, id: string) {
  return (
    (seriesById(chart, id)?.options as unknown as { data?: Array<[number, number]> }).data?.[0]?.[1]
  );
}

function withNewSample(value: number): ResourceMultiSeries[] {
  return initialData.map((server) => ({
    ...server,
    data: server.data.map((point) => ({
      ...point,
      at: 106,
      hostCpuUtilization:
        server.serverId === 'jellyfin' ? value : point.hostCpuUtilization,
    })),
  }));
}

describe('ServerResourceCharts', () => {
  it('defers hidden-series data until the native legend shows it again', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chartUpdate = vi.spyOn(HighchartsLibrary.Chart.prototype, 'update');
    const setData = vi.spyOn(HighchartsLibrary.Series.prototype, 'setData');
    const view = render(<ServerResourceCharts data={undefined} multiSeries={initialData} />);

    await waitFor(() => expect(chartsIn(view.container)).toHaveLength(2));
    const initialCharts = chartsIn(view.container);

    act(() => {
      for (const legendItem of screen.getAllByText('Jellyfin')) {
        fireEvent.click(legendItem);
      }
    });

    for (const chart of initialCharts) {
      expect(seriesById(chart, 'jellyfin')?.visible).toBe(false);
      expect(seriesById(chart, 'dispatcharr')?.visible).toBe(true);
    }

    chartUpdate.mockClear();
    setData.mockClear();
    act(() => {
      view.rerender(<ServerResourceCharts data={undefined} multiSeries={withNewSample(11)} />);
    });

    expect(chartsIn(view.container)).toEqual(initialCharts);
    expect(chartUpdate).not.toHaveBeenCalled();
    expect(setData).toHaveBeenCalledTimes(2);
    for (const chart of initialCharts) {
      const jellyfin = seriesById(chart, 'jellyfin');
      expect(jellyfin?.visible).toBe(false);
    }

    act(() => {
      for (const legendItem of screen.getAllByText('Jellyfin')) {
        fireEvent.click(legendItem);
      }
    });

    // Showing the last hidden series returns to the ordinary adapter flow,
    // which updates both visible series in each chart after flushing pending data.
    expect(chartUpdate).toHaveBeenCalled();
    expect(setData).toHaveBeenCalledTimes(8);
    for (const chart of initialCharts) {
      expect(seriesById(chart, 'jellyfin')?.visible).toBe(true);
    }
    expect(initialCharts.map((chart) => firstDataValue(chart, 'jellyfin')).sort()).toEqual([11, 40]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('adds and removes server series without recreating the charts', async () => {
    const view = render(<ServerResourceCharts data={undefined} multiSeries={initialData} />);

    await waitFor(() => expect(chartsIn(view.container)).toHaveLength(2));
    const initialCharts = chartsIn(view.container);

    act(() => {
      view.rerender(<ServerResourceCharts data={undefined} multiSeries={[initialData[0]!]} />);
    });
    for (const chart of initialCharts) {
      expect(seriesById(chart, 'jellyfin')).toBeDefined();
      expect(seriesById(chart, 'dispatcharr')).toBeUndefined();
    }

    act(() => {
      view.rerender(<ServerResourceCharts data={undefined} multiSeries={initialData} />);
    });
    expect(chartsIn(view.container)).toEqual(initialCharts);
    for (const chart of initialCharts) {
      expect(seriesById(chart, 'dispatcharr')).toBeDefined();
    }
  });
});
