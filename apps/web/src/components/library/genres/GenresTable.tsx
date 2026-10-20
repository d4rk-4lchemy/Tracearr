import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tags } from 'lucide-react';
import type { GenreRow } from '@tracearr/shared';
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
import { formatWatchTime } from '@/components/ui/stat-card';
import { usePagerLabels } from '@/components/users/detail/usePagerLabels';
import { formatBytes, formatNumber, formatPercent } from '@/lib/formatters';
import { deltaPercent, formatDelta } from '@/lib/periodWindows';

const PAGE_SIZE = 25;

const columnHelper = createDataTableColumnHelper<GenreRow>();

const getRowId = (row: GenreRow) => row.genre;

interface GenresTableProps {
  rows: GenreRow[];
  onSelect: (genre: string) => void;
}

export function GenresTable({ rows, onSelect }: GenresTableProps) {
  const { t } = useTranslation(['pages', 'common']);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('genre', {
          header: t('pages:media.genres.table.columns.genre'),
          sortFn: 'text',
          meta: { cellClassName: 'font-medium whitespace-normal' },
        }),
        columnHelper.accessor('itemCount', {
          header: t('common:labels.items'),
          meta: { numeric: true },
          cell: ({ getValue }) => formatNumber(getValue()),
        }),
        columnHelper.accessor('sizeBytes', {
          header: t('common:labels.size'),
          meta: { numeric: true },
          cell: ({ getValue }) => formatBytes(getValue()),
        }),
        columnHelper.accessor('plays', {
          header: t('pages:media.genres.table.columns.plays'),
          meta: { numeric: true },
          cell: ({ getValue }) => formatNumber(getValue()),
        }),
        columnHelper.accessor((row) => deltaPercent(row.plays, row.priorPlays) ?? -Infinity, {
          id: 'vsPrior',
          header: t('pages:userDetail.cards.vsPrior'),
          meta: { numeric: true },
          cell: ({ row }) => formatDelta(row.original.plays, row.original.priorPlays) ?? '—',
        }),
        columnHelper.accessor('watchTimeMs', {
          header: t('pages:media.genres.table.columns.watchTime'),
          meta: {
            numeric: true,
            headerClassName: 'hidden min-[1400px]:table-cell',
            cellClassName: 'hidden min-[1400px]:table-cell',
          },
          cell: ({ getValue }) => formatWatchTime(getValue()),
        }),
        columnHelper.accessor((row) => row.finishedRate ?? -1, {
          id: 'finished',
          header: t('pages:userDetail.cards.finished'),
          meta: { numeric: true },
          cell: ({ row }) => {
            const rate = row.original.finishedRate;
            return rate === null ? '—' : formatPercent(rate, 0);
          },
        }),
        columnHelper.accessor((row) => row.topViewer?.share ?? -1, {
          id: 'topViewer',
          header: t('pages:media.genres.table.columns.topViewer'),
          cell: ({ row }) => {
            const viewer = row.original.topViewer;
            return viewer === null ? '—' : `${viewer.name} · ${formatPercent(viewer.share, 0)}`;
          },
        }),
        columnHelper.accessor((row) => row.neverPlayed.count, {
          id: 'neverPlayed',
          header: t('pages:requests.page.kpi.neverPlayed'),
          meta: { numeric: true },
          cell: ({ row }) => {
            const { count, bytes } = row.original.neverPlayed;
            return count === 0 ? '0' : `${formatNumber(count)} · ${formatBytes(bytes)}`;
          },
        }),
      ]),
    [t]
  );

  const { table, pager } = useDataTable<GenreRow>({
    columns,
    data: rows,
    getRowId,
    pageSize: PAGE_SIZE,
  });
  const pagerLabels = usePagerLabels(pager.page, pager.pageCount);

  return (
    <DataTableRoot density="compact">
      <DataTableViewport flush>
        <DataTableHeader table={table} />
        <DataTableBody
          table={table}
          onRowClick={(row) => onSelect(row.genre)}
          empty={
            <DataTableEmpty table={table} icon={Tags} title={t('pages:media.genres.empty.title')} />
          }
        />
      </DataTableViewport>
      <DataTablePager variant="footer" {...pager} labels={pagerLabels} />
    </DataTableRoot>
  );
}
