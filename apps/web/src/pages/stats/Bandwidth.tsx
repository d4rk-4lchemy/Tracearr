import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { Activity, Users, Gauge, Clock, HardDrive } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatCard, formatWatchTime } from '@/components/ui/stat-card';
import { DailyBandwidthChart } from '@/components/charts/DailyBandwidthChart';
import { InlineErrorState } from '@/components/library/ErrorState';
import { TOP_PEOPLE_LIMIT, TopPeoplePreview } from '@/components/stats/TopPeoplePreview';
import { useBandwidthDaily, useBandwidthSummary, usePeople } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useTimeRange } from '@/hooks/useTimeRange';
import { formatBytes } from '@/lib/formatters';
import { withRangeParams } from '@/lib/rangeParams';

export function StatsBandwidth() {
  const { t } = useTranslation(['pages', 'common']);
  const { value: timeRange, apiParams, apiDayParams } = useTimeRange();
  const { selectedServerIds, selectedServers, isMultiServer } = useServer();
  const { search } = useLocation();

  const daily = useBandwidthDaily(apiParams, selectedServerIds);
  const summary = useBandwidthSummary(apiParams, selectedServerIds);
  const people = usePeople(apiDayParams, selectedServerIds, {
    rank: 'data',
    pageSize: TOP_PEOPLE_LIMIT,
  });

  const summaryData = summary.data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary.isError ? (
        <InlineErrorState
          message={summary.error?.message ?? t('common:errors.unexpectedError')}
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <StatCard
            icon={Activity}
            label={t('common:labels.totalSessions')}
            value={summaryData?.totalSessions.toLocaleString() ?? 0}
            isLoading={summary.isLoading}
          />
          <StatCard
            icon={HardDrive}
            label={t('statsBandwidth.dataTransferred')}
            value={formatBytes(summaryData?.totalBytes ?? 0)}
            isLoading={summary.isLoading}
          />
          <StatCard
            icon={Gauge}
            label={t('statsBandwidth.avgBitrate')}
            value={`${summaryData?.avgBitrateMbps.toFixed(1) ?? 0} Mbps`}
            subValue={t('statsBandwidth.peakBitrate', {
              value: summaryData?.peakBitrateMbps.toFixed(1) ?? 0,
            })}
            isLoading={summary.isLoading}
          />
          <StatCard
            icon={Clock}
            label={t('statsBandwidth.totalWatchTime')}
            value={formatWatchTime(summaryData?.totalDurationMs ?? 0)}
            isLoading={summary.isLoading}
          />
          <StatCard
            icon={Users}
            label={t('statsBandwidth.uniqueUsers')}
            value={summaryData?.uniqueUsers ?? 0}
            isLoading={summary.isLoading}
          />
        </div>
      )}

      {/* Bandwidth Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t('statsBandwidth.dailyUsage')}</CardTitle>
          <CardDescription>{t('statsBandwidth.dailyUsageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {daily.isError ? (
            <InlineErrorState
              message={daily.error?.message ?? t('common:errors.unexpectedError')}
              onRetry={() => void daily.refetch()}
            />
          ) : (
            <DailyBandwidthChart
              data={daily.data?.data}
              isLoading={daily.isLoading}
              height={300}
              period={timeRange.period}
              isMultiServer={isMultiServer}
              selectedServers={selectedServers}
            />
          )}
        </CardContent>
      </Card>

      <TopPeoplePreview
        rows={people.data?.data}
        isLoading={people.isLoading}
        error={people.error}
        onRetry={() => void people.refetch()}
        rankHref={withRangeParams('/stats/people?rank=data', search)}
        title={t('statsBandwidth.topPeopleTitle')}
        caption={t('statsBandwidth.topPeopleCaption')}
      />
    </div>
  );
}
