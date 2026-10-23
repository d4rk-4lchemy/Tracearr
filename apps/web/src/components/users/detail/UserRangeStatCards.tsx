import { useTranslation } from 'react-i18next';
import { CalendarDays, CheckCircle2, Clock, HardDrive, MonitorPlay, Play } from 'lucide-react';
import { formatBitrate, type UserRangeStats } from '@tracearr/shared';
import { formatNumber, StatCard } from '@/components/ui/stat-card';
import { formatWatchTime } from '@/lib/dateFormat';
import { InlineErrorState } from '@/components/library/ErrorState';
import { formatBytes } from '@/lib/formatters';

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);

function percentChange(current: number, prior: number | null): number | null {
  if (prior === null || prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

interface UserRangeStatCardsProps {
  stats: UserRangeStats | undefined;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export function UserRangeStatCards({ stats, isLoading, error, onRetry }: UserRangeStatCardsProps) {
  const { t } = useTranslation(['pages', 'common']);
  if (error && onRetry) {
    return (
      <InlineErrorState
        message={error.message || t('common:errors.unexpectedError')}
        onRetry={onRetry}
      />
    );
  }
  const loading = isLoading || !stats;
  const playsDelta = stats ? percentChange(stats.plays, stats.priorPlays) : null;

  return (
    <div
      data-testid="range-stat-cards"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <StatCard
        icon={Play}
        label={t('common:labels.plays')}
        value={formatNumber(stats?.plays ?? 0)}
        delta={
          playsDelta === null
            ? undefined
            : { value: playsDelta, label: t('pages:userDetail.cards.vsPrior') }
        }
        isLoading={loading}
      />
      <StatCard
        icon={Clock}
        label={t('common:labels.watchTime')}
        value={formatWatchTime(stats?.watchMs ?? 0)}
        subValue={
          stats && stats.activeDays > 0
            ? t('pages:userDetail.cards.perActiveDay', {
                value: formatWatchTime(stats.watchMs / stats.activeDays),
              })
            : undefined
        }
        isLoading={loading}
      />
      <StatCard
        icon={CheckCircle2}
        label={t('pages:userDetail.cards.finished')}
        value={percent(stats?.finishedRate ?? null)}
        subValue={
          stats?.abandonedRate == null
            ? undefined
            : t('pages:userDetail.cards.abandoned', { value: Math.round(stats.abandonedRate) })
        }
        isLoading={loading}
      />
      <StatCard
        icon={MonitorPlay}
        label={t('common:playback.directPlay')}
        value={percent(stats?.directPlayRate ?? null)}
        subValue={t('pages:userDetail.cards.transcodes', { count: stats?.transcodes ?? 0 })}
        isLoading={loading}
      />
      <StatCard
        icon={HardDrive}
        label={t('common:labels.data')}
        value={formatBytes(stats?.bytes ?? 0)}
        subValue={
          stats?.avgBitrateKbps == null
            ? undefined
            : t('pages:userDetail.cards.avgBitrate', { value: formatBitrate(stats.avgBitrateKbps) })
        }
        isLoading={loading}
      />
      <StatCard
        icon={CalendarDays}
        label={t('pages:userDetail.cards.daysActive')}
        value={formatNumber(stats?.activeDays ?? 0)}
        valueSuffix={
          stats?.daysInRange == null
            ? undefined
            : t('pages:userDetail.cards.ofDays', { count: stats.daysInRange })
        }
        subValue={
          stats && stats.currentStreak > 0
            ? t('pages:userDetail.cards.streak', { count: stats.currentStreak })
            : undefined
        }
        isLoading={loading}
      />
    </div>
  );
}
