import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, HardDrive, Trophy, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTablePager } from '@/components/ui/data-table';
import { InlineErrorState } from '@/components/library/ErrorState';
import { DownloadsTable } from '@/components/downloads/DownloadsTable';
import { usePagerLabels } from '@/components/users/detail/usePagerLabels';
import { useDownloadsStats } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useTimeRange } from '@/hooks/useTimeRange';
import { formatBytes } from '@/lib/formatters';

function DownloadsView() {
  const { t } = useTranslation(['pages', 'common', 'nav']);
  const { apiParams } = useTimeRange();
  const { selectedServerIds, isMultiServer } = useServer();
  const [page, setPage] = useState(1);

  const downloads = useDownloadsStats(apiParams, selectedServerIds, page);
  const data = downloads.data;
  const pageCount = data ? Math.ceil(data.total / data.pageSize) : 0;
  const labels = usePagerLabels(page, pageCount);

  if (downloads.isError) {
    return (
      <InlineErrorState
        message={downloads.error?.message ?? t('common:errors.unexpectedError')}
        onRetry={() => void downloads.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard
          icon={Download}
          label={t('nav:downloads')}
          value={data?.total.toLocaleString() ?? 0}
          isLoading={downloads.isLoading}
        />
        <StatCard
          icon={HardDrive}
          label={t('downloads.dataDownloaded')}
          value={formatBytes(data?.totalBytes)}
          isLoading={downloads.isLoading}
        />
        <StatCard
          icon={Users}
          label={t('downloads.peopleDownloading')}
          value={data?.people.toLocaleString() ?? 0}
          isLoading={downloads.isLoading}
        />
        <StatCard
          icon={Trophy}
          label={t('downloads.mostDownloaded')}
          value={data?.topTitle?.title ?? '—'}
          subValue={
            data?.topTitle ? t('common:count.download', { count: data.topTitle.count }) : undefined
          }
          truncateValue
          isLoading={downloads.isLoading}
        />
      </div>

      <Card>
        <CardContent className="space-y-4">
          <DownloadsTable
            rows={data?.rows ?? []}
            isLoading={downloads.isLoading}
            showUser
            showServer={isMultiServer}
            empty={<EmptyState icon={Download} title={t('downloads.empty')} className="py-8" />}
          />
          <DataTablePager
            page={page}
            pageCount={pageCount}
            canPrevious={page > 1}
            canNext={page < pageCount}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
            onPage={setPage}
            labels={labels}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function StatsDownloads() {
  const { apiParams } = useTimeRange();
  const { selectedServerIds } = useServer();
  return <DownloadsView key={`${JSON.stringify(apiParams)}|${selectedServerIds.join(',')}`} />;
}
