import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import type { PersonRow } from '@tracearr/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  createDataTableColumnHelper,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader,
  DataTableRoot,
  DataTableViewport,
  useDataTable,
} from '@/components/ui/data-table';
import { InlineErrorState } from '@/components/library/ErrorState';
import { OpenPeopleButton } from '@/components/stats/PeopleLink';
import { DirectPlayCell, PersonCell } from '@/components/stats/PeopleTable';
import { formatBytes } from '@/lib/formatters';

export const TOP_PEOPLE_LIMIT = 5;

const columnHelper = createDataTableColumnHelper<PersonRow>();

const getRowId = (row: PersonRow) => row.userId;

interface TopPeoplePreviewProps {
  rows: PersonRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  rankHref: string;
  title: string;
  caption: string;
}

export function TopPeoplePreview({
  rows,
  isLoading,
  error,
  onRetry,
  rankHref,
  title,
  caption,
}: TopPeoplePreviewProps) {
  const { t } = useTranslation(['pages', 'common']);

  // The endpoint lists zero-play people too, ranked after everyone who played.
  const data = useMemo(
    () => rows?.filter((row) => row.plays > 0).slice(0, TOP_PEOPLE_LIMIT),
    [rows]
  );

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'person',
          header: t('statsUsers.columns.person'),
          enableSorting: false,
          cell: ({ row }) => <PersonCell person={row.original} />,
        }),
        columnHelper.display({
          id: 'data',
          header: t('common:labels.data'),
          enableSorting: false,
          meta: { numeric: true, cellClassName: 'font-semibold' },
          cell: ({ row }) => formatBytes(row.original.bytes),
        }),
        columnHelper.display({
          id: 'plays',
          header: t('common:labels.plays'),
          enableSorting: false,
          meta: { numeric: true },
          cell: ({ row }) => row.original.plays.toLocaleString(),
        }),
        columnHelper.display({
          id: 'direct',
          header: t('common:playback.directPlay'),
          enableSorting: false,
          meta: { numeric: true },
          cell: ({ row }) => <DirectPlayCell rate={row.original.directPlayRate} />,
        }),
      ]),
    [t]
  );

  const { table } = useDataTable<PersonRow>({
    columns,
    data,
    getRowId,
    pageSize: TOP_PEOPLE_LIMIT,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <InlineErrorState message={error.message} onRetry={onRetry} />
        ) : (
          <DataTableRoot density="compact">
            <DataTableViewport flush>
              <DataTableHeader table={table} />
              <DataTableBody
                table={table}
                isLoading={isLoading}
                skeletonRows={TOP_PEOPLE_LIMIT}
                loadingLabel={t('common:states.loading')}
                empty={
                  <DataTableEmpty table={table} icon={Users} title={t('common:empty.noUserData')} />
                }
              />
            </DataTableViewport>
          </DataTableRoot>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <OpenPeopleButton href={rankHref} />
      </CardFooter>
    </Card>
  );
}
