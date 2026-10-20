import { useTranslation } from 'react-i18next';
import { Clock, Layers, Repeat, Users } from 'lucide-react';
import type { PeopleSummary } from '@tracearr/shared';
import { StatCard } from '@/components/ui/stat-card';
import { formatPercent } from '@/lib/formatters';

interface PeopleSummaryCardsProps {
  summary: PeopleSummary | undefined;
}

export function PeopleSummaryCards({ summary }: PeopleSummaryCardsProps) {
  const { t } = useTranslation('pages');
  const isLoading = summary === undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Users}
        label={t('statsUsers.summary.active')}
        value={(summary?.activePeople ?? 0).toLocaleString()}
        valueSuffix={t('statsUsers.summary.activeOf', { total: summary?.totalPeople ?? 0 })}
        isLoading={isLoading}
      />
      <StatCard
        icon={Layers}
        label={t('statsUsers.summary.topThreeShare')}
        value={formatPercent(summary?.topThreeShare, 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Repeat}
        label={t('statsUsers.summary.transcoderShare')}
        value={formatPercent(summary?.topTranscoderShare, 0)}
        subValue={t('statsUsers.summary.transcodesOf', {
          top: summary?.topTranscoderCount ?? 0,
          total: summary?.totalTranscodes ?? 0,
        })}
        isLoading={isLoading}
      />
      <StatCard
        icon={Clock}
        label={t('statsUsers.summary.quiet')}
        value={(summary?.quietPeople ?? 0).toLocaleString()}
        subValue={t('statsUsers.summary.quietDays', { days: summary?.quietDays ?? 90 })}
        isLoading={isLoading}
      />
    </div>
  );
}
