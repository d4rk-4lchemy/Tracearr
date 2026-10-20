import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Users as UsersIcon } from 'lucide-react';
import { listPageCount, PEOPLE_RANKS, type PeopleRank } from '@tracearr/shared';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FilterBar,
  useFilterState,
  type FilterDescriptor,
  type FilterState,
} from '@/components/ui/filters';
import { ErrorState } from '@/components/library/ErrorState';
import { PeopleSummaryCards } from '@/components/stats/PeopleSummaryCards';
import { PeopleTable, PEOPLE_PAGE_SIZE } from '@/components/stats/PeopleTable';
import { RankBySwitch } from '@/components/stats/RankBySwitch';
import { usePeople, useRequestsConfigured } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useTimeRange } from '@/hooks/useTimeRange';

type PeopleFilterState = FilterState & { search?: string };

const FILTER_DEFAULTS: PeopleFilterState = {};

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function StatsPeople() {
  const { t } = useTranslation(['pages', 'common']);
  const { apiDayParams } = useTimeRange();
  const { selectedServerIds } = useServer();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestsConfigured = useRequestsConfigured().data?.configured ?? false;
  const ranks = requestsConfigured
    ? PEOPLE_RANKS
    : PEOPLE_RANKS.filter((candidate) => candidate !== 'requests');
  const rank = ranks.find((candidate) => candidate === searchParams.get('rank')) ?? 'plays';
  const requestedPage = parsePage(searchParams.get('page'));

  const descriptors = useMemo<FilterDescriptor[]>(
    () => [
      {
        kind: 'search',
        key: 'search',
        label: t('common:actions.search'),
        placeholder: t('common:search.searchUsers'),
        clearLabel: t('common:filters.clearSearch'),
        inline: true,
        className: 'w-full sm:w-64',
      },
    ],
    [t]
  );
  const { filters, setFilters } = useFilterState<PeopleFilterState>({
    descriptors,
    defaults: FILTER_DEFAULTS,
  });
  const search = filters.search;

  const people = usePeople(apiDayParams, selectedServerIds, {
    rank,
    page: requestedPage,
    pageSize: PEOPLE_PAGE_SIZE,
    search,
  });

  const data = people.data;
  const pageCount = data ? Math.max(1, listPageCount(data.meta)) : 1;
  const page = data ? Math.min(requestedPage, pageCount) : requestedPage;

  const writeParams = (change: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };

  const onRankChange = (next: PeopleRank) =>
    writeParams((params) => {
      params.set('rank', next);
      params.delete('page');
    });

  const onPageChange = (next: number) =>
    writeParams((params) => {
      if (next > 1) params.set('page', String(next));
      else params.delete('page');
    });

  const pastLastPage = data !== undefined && requestedPage > pageCount;
  useEffect(() => {
    if (pastLastPage) onPageChange(1);
  });

  if (people.isError) {
    return (
      <ErrorState
        title={t('common:errors.somethingWentWrong')}
        message={people.error.message}
        onRetry={() => void people.refetch()}
      />
    );
  }

  if (data && data.summary.activePeople === 0 && !search) {
    return (
      <EmptyState
        icon={UsersIcon}
        title={t('statsUsers.noActivity')}
        description={t('statsUsers.noActivityDesc')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PeopleSummaryCards summary={data?.summary} />

      <Card>
        <CardContent className="space-y-4">
          <FilterBar
            descriptors={descriptors}
            value={filters}
            onChange={(next) => {
              setFilters(next);
              onPageChange(1);
            }}
            defaults={FILTER_DEFAULTS}
            labels={{
              trigger: t('common:labels.filters'),
              panelTitle: t('common:labels.filters'),
              clearAll: t('common:filters.clearAll'),
              done: t('common:filters.done'),
              removeFilter: (label: string) => t('common:filters.remove', { label }),
            }}
          >
            <div className="ml-auto">
              <RankBySwitch ranks={ranks} value={rank} onChange={onRankChange} />
            </div>
          </FilterBar>

          <PeopleTable
            rows={data?.data}
            rank={rank}
            page={page}
            pageCount={pageCount}
            onPageChange={onPageChange}
            isLoading={people.isLoading}
            showRequests={requestsConfigured}
          />
        </CardContent>
      </Card>
    </div>
  );
}
