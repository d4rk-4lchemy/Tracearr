import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import type { StorageLibraryRow } from '@tracearr/shared';
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
import { usePagerLabels } from '@/components/users/detail/usePagerLabels';
import { formatBytes, formatNumber } from '@/lib/formatters';
import { ShareBar } from './genres/ShareBars';

const PAGE_SIZE = 25;

export type StorageLibraryTableRow = StorageLibraryRow & { serverId: string; serverName: string };

type Row = StorageLibraryTableRow & { share: number };

const MOVIES = 'common:media.movie_plural';
const SHOWS = 'common:media.tvShows';
const MUSIC = 'common:media.music';

/** Library types arrive server-native: Plex movie/show/artist, Jellyfin and Emby movies/tvshows/music. */
const TYPE_LABEL_KEYS = new Map<string, typeof MOVIES | typeof SHOWS | typeof MUSIC>([
  ['movie', MOVIES],
  ['movies', MOVIES],
  ['show', SHOWS],
  ['shows', SHOWS],
  ['tvshows', SHOWS],
  ['tv', SHOWS],
  ['artist', MUSIC],
  ['music', MUSIC],
]);

const columnHelper = createDataTableColumnHelper<Row>();

const getRowId = (row: Row) => `${row.serverId}:${row.libraryId}`;

interface StorageLibrariesTableProps {
  rows: StorageLibraryTableRow[];
  isLoading?: boolean;
}

/** Every library with its size and its share of the bytes across the rows given. */
export function StorageLibrariesTable({ rows, isLoading }: StorageLibrariesTableProps) {
  const { t } = useTranslation(['pages', 'common']);

  const data = useMemo(() => {
    const totalBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
    return rows
      .map((row) => ({ ...row, share: totalBytes > 0 ? (row.sizeBytes / totalBytes) * 100 : 0 }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  }, [rows]);
  const multiServer = new Set(rows.map((row) => row.serverId)).size > 1;

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: t('pages:library.storage.libraries.columns.library'),
          sortFn: 'text',
          meta: { cellClassName: 'font-medium' },
        }),
        ...(multiServer
          ? [
              columnHelper.accessor('serverName', {
                header: t('common:labels.server'),
                sortFn: 'text',
              }),
            ]
          : []),
        columnHelper.accessor('mediaType', {
          header: t('common:labels.type'),
          cell: ({ getValue }) => {
            const key = TYPE_LABEL_KEYS.get(getValue());
            return key ? t(key) : getValue();
          },
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
        columnHelper.accessor('share', {
          header: t('pages:library.storage.libraries.columns.share'),
          meta: { cellClassName: 'w-48' },
          cell: ({ getValue }) => (
            <ShareBar value={getValue()} scale={100} className="bg-primary" />
          ),
        }),
      ]),
    [t, multiServer]
  );

  const { table, pager } = useDataTable<Row>({ columns, data, getRowId, pageSize: PAGE_SIZE });
  const pagerLabels = usePagerLabels(pager.page, pager.pageCount);

  return (
    <DataTableRoot density="compact">
      <DataTableViewport flush>
        <DataTableHeader table={table} />
        <DataTableBody
          table={table}
          isLoading={isLoading}
          empty={<DataTableEmpty table={table} icon={HardDrive} title={t('common:empty.noData')} />}
        />
      </DataTableViewport>
      <DataTablePager variant="footer" {...pager} labels={pagerLabels} />
    </DataTableRoot>
  );
}
