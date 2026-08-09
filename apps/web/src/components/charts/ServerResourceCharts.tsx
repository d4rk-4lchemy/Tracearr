import { useMemo } from 'react';
import Highcharts from 'highcharts';
import { HighchartsReact } from 'highcharts-react-official';
import type { ServerResourceDataPoint } from '@tracearr/shared';
import {
  LIVE_STATS_TICK_INTERVAL,
  LIVE_STATS_TICK_INTERVAL_NARROW,
  LIVE_STATS_X_LABELS,
} from './liveStatsAxis';
import { ChartSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cpu, MemoryStick } from 'lucide-react';

// Colors matching Plex's style
const COLORS = {
  process: '#00b4e4', // Plex-style cyan for "Plex Media Server"
  system: '#cc7b9f', // Pink/purple for "System"
  processGradientStart: 'rgba(0, 180, 228, 0.3)',
  processGradientEnd: 'rgba(0, 180, 228, 0.05)',
  systemGradientStart: 'rgba(204, 123, 159, 0.3)',
  systemGradientEnd: 'rgba(204, 123, 159, 0.05)',
};

export interface ResourceMultiSeries {
  serverId: string;
  serverName: string;
  color: string;
  data: ServerResourceDataPoint[];
}

interface ServerResourceChartsProps {
  data: ServerResourceDataPoint[] | undefined;
  isLoading?: boolean;
  averages?: {
    hostCpu: number | null;
    processCpu: number;
    hostMemory: number | null;
    processMemory: number;
  } | null;
  /** One host-metric line per server; replaces the process/system split */
  multiSeries?: ResourceMultiSeries[];
  /** Single-view name for the process series (defaults to Plex's) */
  processLabel?: string;
}

interface ResourceChartProps {
  title: string;
  icon: React.ReactNode;
  data: ServerResourceDataPoint[] | undefined;
  processKey: 'processCpuUtilization' | 'processMemoryUtilization';
  hostKey: 'hostCpuUtilization' | 'hostMemoryUtilization';
  processAvg?: number;
  hostAvg?: number | null;
  isLoading?: boolean;
  multiSeries?: ResourceMultiSeries[];
  processLabel?: string;
}

/**
 * Single resource chart (CPU or RAM)
 */
function ResourceChart({
  title,
  icon,
  data,
  processKey,
  hostKey,
  processAvg,
  hostAvg,
  isLoading,
  multiSeries,
  processLabel,
}: ResourceChartProps) {
  const isMulti = !!multiSeries && multiSeries.length > 0;
  const hasData = isMulti ? multiSeries.some((s) => s.data.length > 0) : !!data && data.length > 0;

  const chartOptions = useMemo<Highcharts.Options>(() => {
    if (!hasData) {
      return {};
    }

    let series: Highcharts.SeriesOptionsType[];
    let allValues: number[];

    if (isMulti) {
      // Anchor each server to its own newest sample: media server clocks
      // disagree, and a shared anchor lets one skewed clock push every other
      // line off the fixed -120..0 axis
      series = multiSeries
        .filter((s) => s.data.some((p) => p[hostKey] != null))
        .map((s) => {
          const newestAt = s.data[s.data.length - 1]?.at ?? 0;
          return {
            type: 'line' as const,
            name: s.serverName,
            color: s.color,
            // Samples arrive every 6s; snapping x to that grid puts every
            // server's points on shared positions so the tooltip groups them
            data: s.data.map(
              (p) => [-Math.round((newestAt - p.at) / 6) * 6, p[hostKey]] as [number, number | null]
            ),
          };
        });
      allValues = multiSeries.flatMap((s) =>
        s.data.map((p) => p[hostKey]).filter((v): v is number => v != null)
      );
    } else {
      if (!data || data.length === 0) return {};

      // Map data points to x positions in -120 to 0 range
      // Data is sorted oldest first, spread across the 2-minute window
      const processData: [number, number][] = [];
      const hostData: [number, number | null][] = [];

      const n = data.length;
      for (let i = 0; i < n; i++) {
        const point = data[i];
        if (!point) continue;
        // Spread points from -120 (oldest) to 0 (newest)
        const x = n === 1 ? 0 : -120 + (i * 120) / (n - 1);
        processData.push([x, point[processKey]]);
        hostData.push([x, point[hostKey]]);
      }

      series = [
        {
          type: 'area',
          name: processLabel ?? 'Plex Media Server',
          data: processData,
          color: COLORS.process,
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, COLORS.processGradientStart],
              [1, COLORS.processGradientEnd],
            ],
          },
        },
        {
          type: 'area',
          name: 'System',
          data: hostData,
          color: COLORS.system,
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, COLORS.systemGradientStart],
              [1, COLORS.systemGradientEnd],
            ],
          },
        },
      ];
      allValues = [...processData, ...hostData]
        .map(([, y]) => y)
        .filter((v): v is number => v != null);
    }

    // Calculate dynamic Y-axis max (round up to nearest 10, min 20)
    const maxValue = Math.max(...allValues, 0);
    const yMax = Math.max(20, Math.ceil(maxValue / 10) * 10);

    return {
      chart: {
        type: 'area',
        height: 180,
        backgroundColor: 'transparent',
        style: {
          fontFamily: 'inherit',
        },
        spacing: [10, 10, 15, 10],
        reflow: true,
      },
      title: {
        text: undefined,
      },
      credits: {
        enabled: false,
      },
      legend: {
        enabled: true,
        align: 'left',
        verticalAlign: 'top',
        floating: false,
        itemStyle: {
          color: 'hsl(var(--muted-foreground))',
          fontWeight: 'normal',
          fontSize: '11px',
        },
        itemHoverStyle: {
          color: 'hsl(var(--foreground))',
        },
      },
      xAxis: {
        type: 'linear',
        min: -120,
        max: 0,
        tickInterval: LIVE_STATS_TICK_INTERVAL,
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
            fontSize: '10px',
          },
          formatter: function () {
            return LIVE_STATS_X_LABELS[this.value as number] || '';
          },
        },
        lineColor: 'hsl(var(--border))',
        tickColor: 'hsl(var(--border))',
      },
      yAxis: {
        title: {
          text: undefined,
        },
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
            fontSize: '10px',
          },
          format: '{value}%',
        },
        gridLineColor: 'hsl(var(--border) / 0.5)',
        min: 0,
        max: yMax,
        tickInterval: yMax <= 20 ? 5 : 10,
      },
      plotOptions: {
        series: {
          marker: {
            enabled: false,
            states: {
              hover: {
                enabled: true,
                radius: 3,
              },
            },
          },
          lineWidth: 2,
          states: {
            hover: {
              lineWidth: 2,
            },
          },
          connectNulls: false, // Don't connect across null values
        },
        area: {
          threshold: null,
        },
      },
      tooltip: {
        shared: true,
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
          fontSize: '11px',
        },
        formatter: function () {
          const points = this.points || [];
          let html = '';
          for (const point of points) {
            if (point.y !== null) {
              const color = point.series.color;
              html += `<span style="color:${color}">●</span> ${point.series.name}: <b>${Math.round(point.y as number)}%</b><br/>`;
            }
          }
          return html;
        },
      },
      series,
      responsive: {
        rules: [
          {
            condition: {
              maxWidth: 400,
            },
            chartOptions: {
              legend: {
                align: 'center',
                layout: 'horizontal',
                itemStyle: {
                  fontSize: '10px',
                },
              },
              xAxis: {
                tickInterval: LIVE_STATS_TICK_INTERVAL_NARROW,
                labels: {
                  style: {
                    fontSize: '9px',
                  },
                },
              },
            },
          },
        ],
      },
    };
  }, [data, processKey, hostKey, multiSeries, isMulti, hasData, processLabel]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartSkeleton height={180} />
        </CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed text-sm"
            style={{ height: 180 }}
          >
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-2">
        <HighchartsReact
          highcharts={Highcharts}
          options={chartOptions}
          containerProps={{ style: { width: '100%', height: '100%' } }}
        />
        {/* Averages row */}
        <div className="text-muted-foreground mt-1 flex flex-wrap justify-end gap-4 pr-2 text-xs">
          {isMulti ? (
            multiSeries.map((s) => {
              const values = s.data.map((p) => p[hostKey]).filter((v): v is number => v != null);
              const avg =
                values.length > 0
                  ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
                  : null;
              return (
                <span key={s.serverId}>
                  <span style={{ color: s.color }}>●</span> Avg:{' '}
                  <span className="text-foreground font-medium">{avg ?? '\u2014'}%</span>
                </span>
              );
            })
          ) : (
            <>
              <span>
                <span style={{ color: COLORS.process }}>●</span> Avg:{' '}
                <span className="text-foreground font-medium">{processAvg ?? '\u2014'}%</span>
              </span>
              <span>
                <span style={{ color: COLORS.system }}>●</span> Avg:{' '}
                <span className="text-foreground font-medium">{hostAvg ?? '\u2014'}%</span>
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Server resource monitoring charts (CPU + RAM)
 * Displays real-time server resource utilization matching Plex's dashboard style
 */
export function ServerResourceCharts({
  data,
  isLoading,
  averages,
  multiSeries,
  processLabel,
}: ServerResourceChartsProps) {
  return (
    <>
      <ResourceChart
        title="CPU"
        icon={<Cpu className="h-4 w-4" />}
        data={data}
        processKey="processCpuUtilization"
        hostKey="hostCpuUtilization"
        processAvg={averages?.processCpu}
        hostAvg={averages?.hostCpu}
        isLoading={isLoading}
        multiSeries={multiSeries}
        processLabel={processLabel}
      />
      <ResourceChart
        title="RAM"
        icon={<MemoryStick className="h-4 w-4" />}
        data={data}
        processKey="processMemoryUtilization"
        hostKey="hostMemoryUtilization"
        processAvg={averages?.processMemory}
        hostAvg={averages?.hostMemory}
        isLoading={isLoading}
        multiSeries={multiSeries}
        processLabel={processLabel}
      />
    </>
  );
}
