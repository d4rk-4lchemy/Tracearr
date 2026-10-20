/**
 * Summary statistics display for history page.
 * Shows aggregate totals for filtered results.
 */

import { Play, Clock, Users, Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatCard, formatWatchTime, formatNumber } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';
import type { HistoryAggregates as AggregatesType } from '@tracearr/shared';

interface Props {
  aggregates?: AggregatesType;
  total?: number;
  isLoading?: boolean;
  isFetching?: boolean;
}

export function HistoryAggregates({ aggregates, total, isLoading, isFetching }: Props) {
  const { t } = useTranslation(['common', 'pages']);
  const listenTimeMs = aggregates?.listenTimeMs ?? 0;

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-4',
        isFetching && !isLoading && 'opacity-60'
      )}
    >
      <StatCard
        icon={Play}
        label={t('pages:history.totalPlays')}
        value={formatNumber(total ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Clock}
        label={t('common:labels.watchTime')}
        value={formatWatchTime((aggregates?.totalWatchTimeMs ?? 0) - listenTimeMs)}
        subValue={
          listenTimeMs > 0
            ? `${t('common:labels.listenTime')} ${formatWatchTime(listenTimeMs)}`
            : undefined
        }
        isLoading={isLoading}
      />
      <StatCard
        icon={Users}
        label={t('pages:history.uniqueUsers')}
        value={formatNumber(aggregates?.uniqueUsers ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Film}
        label={t('pages:history.uniqueTitles')}
        value={formatNumber(aggregates?.uniqueContent ?? 0)}
        isLoading={isLoading}
      />
    </div>
  );
}
