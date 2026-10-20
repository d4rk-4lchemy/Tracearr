import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Users } from 'lucide-react';
import type { PeopleRank, PersonRow } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Sparkline } from '@/components/charts/Sparkline';
import {
  createDataTableColumnHelper,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader,
  DataTablePager,
  DataTableRoot,
  DataTableViewport,
  useDataTable,
} from '@/components/ui/data-table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePagerLabels } from '@/components/users/detail/usePagerLabels';
import { UserCell } from '@/components/users/UserCell';
import { formatBytes } from '@/lib/formatters';

export const PEOPLE_PAGE_SIZE = 20;

const MS_PER_HOUR = 3_600_000;

const columnHelper = createDataTableColumnHelper<PersonRow>();

const getRowId = (row: PersonRow) => row.userId;

const RANK_COLUMN: Record<PeopleRank, string> = {
  plays: 'plays',
  hours: 'hours',
  data: 'data',
  transcodes: 'direct',
  requests: 'requests',
  lastSeen: 'lastSeen',
};

export function directShareVariant(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 80) return 'success';
  if (rate >= 50) return 'warning';
  return 'danger';
}

export function PersonCell({ person }: { person: PersonRow }) {
  const { t } = useTranslation('common');
  const serverCount = person.identityServers?.length ?? 0;
  return (
    <UserCell
      serverUserId={person.serverUserId}
      username={person.username}
      identityName={person.identityName}
      thumbUrl={person.thumbUrl}
      serverId={person.serverId}
      details={serverCount > 1 ? [t('count.server', { count: serverCount })] : undefined}
    />
  );
}

export function DirectPlayCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(rate);
  return <Badge variant={directShareVariant(rounded)}>{`${rounded}%`}</Badge>;
}

interface PeopleTableProps {
  rows: PersonRow[] | undefined;
  rank: PeopleRank;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  showRequests?: boolean;
}

export function PeopleTable({
  rows,
  rank,
  page,
  pageCount,
  onPageChange,
  isLoading,
  showRequests = true,
}: PeopleTableProps) {
  const { t } = useTranslation(['pages', 'common']);
  const pagerLabels = usePagerLabels(page, pageCount);

  const columns = useMemo(() => {
    const ranked = RANK_COLUMN[rank];
    const emphasis = (id: string) => (id === ranked ? 'font-semibold' : undefined);

    return columnHelper.columns([
      columnHelper.display({
        id: 'rank',
        header: t('common:labels.rank'),
        enableSorting: false,
        meta: { width: '3rem', cellClassName: 'text-muted-foreground font-medium' },
        cell: ({ row }) => (page - 1) * PEOPLE_PAGE_SIZE + row.index + 1,
      }),
      columnHelper.display({
        id: 'person',
        header: t('statsUsers.columns.person'),
        enableSorting: false,
        cell: ({ row }) => <PersonCell person={row.original} />,
      }),
      columnHelper.display({
        id: 'plays',
        header: t('common:labels.plays'),
        enableSorting: false,
        meta: { numeric: true, cellClassName: emphasis('plays') },
        cell: ({ row }) => row.original.plays.toLocaleString(),
      }),
      columnHelper.display({
        id: 'hours',
        header: t('common:labels.watchTime'),
        enableSorting: false,
        meta: { numeric: true, cellClassName: emphasis('hours') },
        cell: ({ row }) =>
          `${(row.original.watchMs / MS_PER_HOUR).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}h`,
      }),
      columnHelper.display({
        id: 'data',
        header: t('common:labels.data'),
        enableSorting: false,
        meta: { numeric: true, cellClassName: emphasis('data') },
        cell: ({ row }) => formatBytes(row.original.bytes),
      }),
      columnHelper.display({
        id: 'direct',
        header: t('common:playback.directPlay'),
        enableSorting: false,
        meta: { numeric: true, cellClassName: emphasis('direct') },
        cell: ({ row }) => <DirectPlayCell rate={row.original.directPlayRate} />,
      }),
      ...(showRequests
        ? [
            columnHelper.display({
              id: 'requests',
              enableSorting: false,
              meta: { numeric: true, cellClassName: emphasis('requests') },
              header: () => (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help underline decoration-dotted underline-offset-4">
                      {t('statsUsers.columns.requests')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('statsUsers.requestsAllTime')}</TooltipContent>
                </Tooltip>
              ),
              cell: ({ row }) =>
                row.original.requests === 0
                  ? '—'
                  : `${row.original.requests.toLocaleString()} → ${row.original.requestsWatched.toLocaleString()}`,
            }),
          ]
        : []),
      columnHelper.display({
        id: 'trend',
        header: t('statsUsers.columns.trend'),
        enableSorting: false,
        meta: {
          headerClassName: 'hidden min-[1400px]:table-cell',
          cellClassName: 'hidden min-[1400px]:table-cell',
        },
        cell: ({ row }) => <Sparkline values={row.original.trend} />,
      }),
      columnHelper.display({
        id: 'lastSeen',
        header: t('common:labels.lastActivity'),
        enableSorting: false,
        meta: { numeric: true, cellClassName: emphasis('lastSeen') },
        cell: ({ row }) => {
          const lastPlayAt = row.original.lastPlayAt;
          return lastPlayAt === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="whitespace-nowrap">
              {formatDistanceToNowStrict(parseISO(lastPlayAt), { addSuffix: true })}
            </span>
          );
        },
      }),
    ]);
  }, [t, rank, page, showRequests]);

  const { table, pager } = useDataTable<PersonRow>({
    columns,
    data: rows,
    getRowId,
    pageSize: PEOPLE_PAGE_SIZE,
    pageCount,
    page,
    onPageChange,
  });

  return (
    <DataTableRoot density="default">
      <DataTableViewport flush>
        <DataTableHeader table={table} />
        <DataTableBody
          table={table}
          isLoading={isLoading}
          loadingLabel={t('common:states.loading')}
          empty={<DataTableEmpty table={table} icon={Users} title={t('common:empty.noUserData')} />}
        />
      </DataTableViewport>
      <DataTablePager variant="footer" {...pager} labels={pagerLabels} />
    </DataTableRoot>
  );
}
