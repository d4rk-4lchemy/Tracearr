import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Highcharts from 'highcharts';
import { HighchartsReact } from 'highcharts-react-official';
import { PLAYBACK_DECISION_LABEL_KEYS } from '@tracearr/shared';
import { ChartSkeleton } from '@/components/ui/skeleton';
import { axisDateTimeLabelFormats, formatBucketDate, parseChartDate } from '@/lib/dateFormat';
import { ChartEmpty } from './ChartEmpty';
import { chartLang } from './chartUtils';

interface ConcurrentData {
  hour: string;
  total: number;
  direct: number;
  directStream: number;
  transcode: number;
  audioTranscode: number;
}

interface ConcurrentChartProps {
  data: ConcurrentData[] | undefined;
  isLoading?: boolean;
  height?: number;
  period?: 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';
}

export function ConcurrentChart({
  data,
  isLoading,
  height = 250,
  period = 'month',
}: ConcurrentChartProps) {
  const { t } = useTranslation(['common', 'pages']);
  const options = useMemo<Highcharts.Options>(() => {
    if (!data || data.length === 0) {
      return {};
    }

    const points = (value: (d: ConcurrentData) => number): [number, number][] =>
      data.map((d) => [parseChartDate(d.hour), value(d)]);

    return {
      lang: chartLang(),
      chart: {
        type: 'area',
        height,
        backgroundColor: 'transparent',
        style: {
          fontFamily: 'inherit',
        },
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
        align: 'right',
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
        type: 'datetime',
        tickPixelInterval: 120,
        dateTimeLabelFormats: axisDateTimeLabelFormats(true),
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        lineColor: 'hsl(var(--border))',
        tickColor: 'hsl(var(--border))',
        startOnTick: false,
        endOnTick: false,
      },
      yAxis: {
        title: {
          text: undefined,
        },
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        gridLineColor: 'hsl(var(--border))',
        min: 0,
        allowDecimals: false,
      },
      plotOptions: {
        area: {
          stacking: 'normal',
          marker: {
            enabled: false,
            states: {
              hover: {
                enabled: true,
                radius: 4,
              },
            },
          },
          lineWidth: 2,
          states: {
            hover: {
              lineWidth: 2,
            },
          },
          threshold: null,
        },
      },
      tooltip: {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
        },
        shared: true,
        formatter: function () {
          const points = this.points || [];
          const dateStr = formatBucketDate(this.x, period, (date) => t('labels.weekOf', { date }));
          let html = `<b>${dateStr}</b>`;

          let total = 0;
          points.forEach((point) => {
            total += point.y || 0;
            html += `<br/><span style="color:${point.color}">●</span> ${point.series.name}: ${point.y}`;
          });
          html += `<br/><b>${t('pages:activity.peakConcurrent', { value: total })}</b>`;

          return html;
        },
      },
      series: [
        {
          type: 'area',
          name: t(PLAYBACK_DECISION_LABEL_KEYS.directplay),
          data: points((d) => d.direct),
          color: 'hsl(var(--chart-2))',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(var(--chart-2) / 0.4)'],
              [1, 'hsl(var(--chart-2) / 0.1)'],
            ],
          },
        },
        {
          type: 'area',
          name: t(PLAYBACK_DECISION_LABEL_KEYS.copy),
          data: points((d) => d.directStream),
          color: 'hsl(210, 76%, 50%)',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(210 76% 50% / 0.4)'],
              [1, 'hsl(210 76% 50% / 0.1)'],
            ],
          },
        },
        {
          type: 'area',
          name: t(PLAYBACK_DECISION_LABEL_KEYS.audio_transcode),
          data: points((d) => d.audioTranscode),
          color: 'hsl(262, 60%, 58%)',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(262 60% 58% / 0.4)'],
              [1, 'hsl(262 60% 58% / 0.1)'],
            ],
          },
        },
        {
          type: 'area',
          name: t(PLAYBACK_DECISION_LABEL_KEYS.transcode),
          data: points((d) => d.transcode - d.audioTranscode),
          color: 'hsl(var(--chart-4))',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(var(--chart-4) / 0.4)'],
              [1, 'hsl(var(--chart-4) / 0.1)'],
            ],
          },
        },
      ],
      responsive: {
        rules: [
          {
            condition: {
              maxWidth: 400,
            },
            chartOptions: {
              legend: {
                align: 'center',
                verticalAlign: 'bottom',
                itemStyle: {
                  fontSize: '10px',
                },
              },
              xAxis: {
                labels: {
                  style: {
                    fontSize: '9px',
                  },
                },
              },
              yAxis: {
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
  }, [data, height, period, t]);

  if (isLoading) {
    return <ChartSkeleton height={height} />;
  }

  if (!data || data.length === 0) {
    return <ChartEmpty height={height} message={t('pages:activity.noConcurrentData')} />;
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%', height: '100%' } }}
    />
  );
}
