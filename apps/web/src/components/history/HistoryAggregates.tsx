/**
 * Summary statistics display for history page.
 * Shows aggregate totals for filtered results.
 */

import { Play, Clock, Users, Film } from 'lucide-react';
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
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-4',
        isFetching && !isLoading && 'opacity-60'
      )}
    >
      <StatCard
        icon={Play}
        label="Total Plays"
        value={formatNumber(total ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Clock}
        label="Watch Time"
        value={formatWatchTime(aggregates?.totalWatchTimeMs ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Users}
        label="Unique Users"
        value={formatNumber(aggregates?.uniqueUsers ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Film}
        label="Unique Titles"
        value={formatNumber(aggregates?.uniqueContent ?? 0)}
        isLoading={isLoading}
      />
    </div>
  );
}
