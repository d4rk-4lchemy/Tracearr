import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Highcharts from 'highcharts';
import { HighchartsReact } from 'highcharts-react-official';
import type { HourlyDistribution } from '@tracearr/shared';
import { formatHourOfDay } from '@/lib/dateFormat';
import { ChartSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Clock } from 'lucide-react';

interface HourlyDistributionChartProps {
  data: HourlyDistribution[] | undefined;
  isLoading?: boolean;
  height?: number;
}

export function HourlyDistributionChart({
  data,
  isLoading,
  height = 250,
}: HourlyDistributionChartProps) {
  const { t } = useTranslation('pages');
  const options = useMemo<Highcharts.Options>(() => {
    if (!data || data.length === 0) {
      return {};
    }

    return {
      chart: {
        type: 'column',
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
        enabled: false,
      },
      xAxis: {
        categories: data.map((d) => formatHourOfDay(d.hour)),
        labels: {
          rotation: -45,
          style: {
            color: 'hsl(var(--muted-foreground))',
            fontSize: '10px',
          },
        },
        lineColor: 'hsl(var(--border))',
        tickColor: 'hsl(var(--border))',
      },
      yAxis: {
        title: {
          text: t('library.charts.hourly.watches'),
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        gridLineColor: 'hsl(var(--border))',
        min: 0,
      },
      plotOptions: {
        column: {
          borderRadius: 2,
          color: 'hsl(var(--chart-2))',
          pointPadding: 0.1,
          groupPadding: 0.1,
          states: {
            hover: {
              color: 'hsl(var(--chart-2) / 0.8)',
            },
          },
        },
      },
      tooltip: {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
        },
        formatter: function () {
          const label = this.category ?? this.x;
          return `<b>${label}</b><br/>${t('library.charts.watchesValue', { count: this.y ?? 0 })}`;
        },
      },
      series: [
        {
          type: 'column',
          name: t('library.charts.hourly.watches'),
          data: data.map((d) => d.watchCount),
        },
      ],
      responsive: {
        rules: [
          {
            condition: {
              maxWidth: 400,
            },
            chartOptions: {
              xAxis: {
                labels: {
                  style: {
                    fontSize: '8px',
                  },
                  rotation: -60,
                },
              },
              yAxis: {
                title: {
                  text: undefined,
                },
              },
            },
          },
        ],
      },
    };
  }, [data, height, t]);

  if (isLoading) {
    return <ChartSkeleton height={height} />;
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title={t('library.charts.hourly.empty.title')}
        description={t('library.charts.hourly.empty.description')}
      />
    );
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%', height: '100%' } }}
    />
  );
}
