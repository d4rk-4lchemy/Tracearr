import { useTranslation } from 'react-i18next';
import type { UserRangeStats } from '@tracearr/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DayOfWeekChart } from '@/components/charts/DayOfWeekChart';
import { HourStrip } from '@/components/charts/HourStrip';
import { formatHourOfDay } from '@/lib/dateFormat';

type WhenStats = Pick<
  UserRangeStats,
  'playsByDow' | 'playsByHour' | 'personPeakHour' | 'serverPeakHour'
>;

export function WhenCard({
  stats,
  isLoading,
  className,
}: {
  stats: WhenStats | undefined;
  isLoading?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['pages', 'common']);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('common:labels.when')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The chart fills its parent's height, so the parent has to have one. */}
        <div className="h-40">
          <DayOfWeekChart data={stats?.playsByDow} isLoading={isLoading} height={160} />
        </div>
        {stats && (
          <HourStrip
            data={stats.playsByHour}
            peakHour={stats.personPeakHour}
            peakLabel={
              stats.personPeakHour === null
                ? undefined
                : t('pages:userDetail.overview.peak', {
                    hour: formatHourOfDay(stats.personPeakHour),
                  })
            }
            comparePeakLabel={
              stats.serverPeakHour === null
                ? undefined
                : t('pages:userDetail.overview.serverPeak', {
                    hour: formatHourOfDay(stats.serverPeakHour),
                  })
            }
            label={t('pages:userDetail.overview.byHour')}
          />
        )}
      </CardContent>
    </Card>
  );
}
