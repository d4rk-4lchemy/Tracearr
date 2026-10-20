import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Highcharts from 'highcharts';
import { HighchartsReact } from 'highcharts-react-official';
import { ChartSkeleton } from '@/components/ui/skeleton';
import { ChartEmpty } from './ChartEmpty';

interface PlatformData {
  name: string;
  count: number;
}

interface PlatformChartProps {
  data: PlatformData[] | undefined;
  isLoading?: boolean;
  height?: number;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(221, 83%, 53%)', // Blue
  'hsl(142, 76%, 36%)', // Green
  'hsl(38, 92%, 50%)', // Yellow/Orange
  'hsl(262, 83%, 58%)', // Purple
  'hsl(340, 82%, 52%)', // Pink
];

export function PlatformChart({ data, isLoading, height = 200 }: PlatformChartProps) {
  const { t } = useTranslation(['common', 'pages']);
  const options = useMemo<Highcharts.Options>(() => {
    if (!data || data.length === 0) {
      return {};
    }

    return {
      chart: {
        type: 'pie',
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
      tooltip: {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
        },
        pointFormatter: function () {
          return t('pages:activity.playsShare', {
            count: this.y ?? 0,
            percent: (this.percentage ?? 0).toFixed(1),
          });
        },
      },
      plotOptions: {
        pie: {
          innerSize: '60%',
          borderWidth: 0,
          dataLabels: {
            enabled: false,
          },
          showInLegend: true,
          colors: COLORS,
        },
      },
      legend: {
        align: 'right',
        verticalAlign: 'middle',
        layout: 'vertical',
        itemStyle: {
          color: 'hsl(var(--foreground))',
        },
        itemHoverStyle: {
          color: 'hsl(var(--primary))',
        },
      },
      series: [
        {
          type: 'pie',
          name: t('labels.platform'),
          data: data.map((d, i) => ({
            name: d.name,
            y: d.count,
            color: COLORS[i % COLORS.length],
          })),
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
                layout: 'horizontal',
                itemStyle: {
                  fontSize: '10px',
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
    return <ChartEmpty height={height} message={t('pages:activity.noPlatformData')} />;
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%', height: '100%' } }}
    />
  );
}
