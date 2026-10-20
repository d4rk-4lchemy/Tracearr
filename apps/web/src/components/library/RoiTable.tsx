import { BarChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoiResponse, Server } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { DataTablePager } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useServerColorMap } from '@/hooks/useServerColorMap';
import { ServerColumnCell } from '@/components/server';
import { ValueCategoryBadge } from '@/components/library';
import { EmptyState } from '@/components/ui/empty-state';
import { MediaTypeBadge } from './badges';
import {
  SortableTableHead,
  nextSortOrder,
  type SortOrder,
} from '@/components/ui/sortable-table-head';

type SortBy = 'watch_hours_per_gb' | 'value_score' | 'file_size' | 'title';
type MediaTypeFilter = 'all' | 'movie' | 'show' | 'artist';

interface RoiTableProps {
  data: RoiResponse | undefined;
  isLoading?: boolean;
  page: number;
  onPageChange: (page: number) => void;
  sortBy: SortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: SortBy, sortOrder: SortOrder) => void;
  mediaType: MediaTypeFilter;
  onMediaTypeChange: (mediaType: MediaTypeFilter) => void;
  isMultiServer?: boolean;
  selectedServers?: Server[];
}

/**
 * Table component for displaying ROI (Return on Investment) analysis.
 * Server-side sortable by watch hours, file size, hours per GB, and title.
 */
export function RoiTable({
  data,
  isLoading,
  page,
  onPageChange,
  sortBy,
  sortOrder,
  onSortChange,
  mediaType,
  onMediaTypeChange,
  isMultiServer = false,
  selectedServers = [],
}: RoiTableProps) {
  const { t } = useTranslation(['pages', 'common']);

  const colorMap = useServerColorMap();

  const handleSort = (field: SortBy) => {
    onSortChange(field, nextSortOrder(field, sortBy, sortOrder, 'asc'));
  };

  const filterSelect = (
    <Select value={mediaType} onValueChange={(v) => onMediaTypeChange(v as MediaTypeFilter)}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t('library.storage.stale.allTypes')}</SelectItem>
        <SelectItem value="movie">{t('common:media.movie_plural')}</SelectItem>
        <SelectItem value="show">{t('common:media.tvShows')}</SelectItem>
        <SelectItem value="artist">{t('common:media.music')}</SelectItem>
      </SelectContent>
    </Select>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">{filterSelect}</div>
        <div className="flex h-48 items-center justify-center">
          <div className="text-muted-foreground">{t('common:states.loading')}</div>
        </div>
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">{filterSelect}</div>
        <EmptyState
          icon={BarChart}
          title={t('library.storage.roi.empty.title')}
          description={t('library.storage.roi.empty.description')}
        />
      </div>
    );
  }

  const totalPages = Math.ceil(data.pagination.total / data.pagination.pageSize);

  return (
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex items-center justify-end">{filterSelect}</div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">{t('common:labels.type')}</TableHead>
            <SortableTableHead
              field="title"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              {t('library.storage.colTitle')}
            </SortableTableHead>
            {isMultiServer && <TableHead>{t('common:labels.server')}</TableHead>}
            <SortableTableHead
              field="file_size"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              {t('common:labels.size')}
            </SortableTableHead>
            <TableHead>{t('common:labels.watchHours')}</TableHead>
            <SortableTableHead
              field="watch_hours_per_gb"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              {t('library.storage.roi.columns.hoursPerGb')}
            </SortableTableHead>
            <TableHead>{t('library.storage.roi.columns.value')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => {
            const serverColor = isMultiServer ? (colorMap.get(item.serverId) ?? null) : null;
            const accentStyle = serverColor
              ? { boxShadow: `inset 3px 0 0 0 ${serverColor}` }
              : undefined;
            const rowServer = isMultiServer
              ? (selectedServers.find((s) => s.id === item.serverId) ?? null)
              : null;

            return (
              <TableRow key={item.id} style={accentStyle}>
                <TableCell>
                  <MediaTypeBadge mediaType={item.mediaType} />
                </TableCell>
                <TableCell>
                  <span className="font-medium">{item.title}</span>
                  {item.year && <span className="text-muted-foreground ml-1">({item.year})</span>}
                </TableCell>
                {isMultiServer && (
                  <TableCell>
                    {rowServer ? (
                      <ServerColumnCell server={rowServer} />
                    ) : (
                      <Badge variant="outline">{item.serverName}</Badge>
                    )}
                  </TableCell>
                )}
                <TableCell>{item.fileSizeGb.toFixed(1)} GB</TableCell>
                <TableCell>{item.totalWatchHours.toFixed(1)}</TableCell>
                <TableCell>{item.watchHoursPerGb.toFixed(2)}</TableCell>
                <TableCell>
                  <ValueCategoryBadge
                    category={item.valueCategory}
                    suggestDeletion={item.suggestDeletion}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <DataTablePager
        page={page}
        pageCount={totalPages}
        canPrevious={page > 1}
        canNext={page < totalPages}
        onPrevious={() => onPageChange(page - 1)}
        onNext={() => onPageChange(page + 1)}
        onPage={onPageChange}
        labels={{
          navigation: t('common:table.pagination'),
          status: t('common:table.pageOf', { page, total: totalPages }),
          previous: t('common:actions.previous'),
          next: t('common:actions.next'),
          goToPage: t('common:table.goToPage'),
        }}
        className="px-2"
      />
    </div>
  );
}
