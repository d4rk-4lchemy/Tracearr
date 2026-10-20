import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Tags } from 'lucide-react';
import { formatHour, HourStrip, peakHourOf } from '@/components/charts/HourStrip';
import { ErrorState } from '@/components/library/ErrorState';
import { GenreSheet } from '@/components/library/genres/GenreSheet';
import { GenresTable } from '@/components/library/genres/GenresTable';
import { GenreStatCards } from '@/components/library/genres/GenreStatCards';
import { GenreTrends } from '@/components/library/genres/GenreTrends';
import { ShareBars } from '@/components/library/genres/ShareBars';
import { LibraryEmptyState } from '@/components/library/LibraryEmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useGenres } from '@/hooks/queries';
import { useMediaType } from '@/hooks/useMediaType';
import { useServer } from '@/hooks/useServer';
import { useTimeRange } from '@/hooks/useTimeRange';

function GenresSkeleton() {
  return (
    <div className="space-y-6" data-testid="genres-skeleton">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-96" />
    </div>
  );
}

export function LibraryGenres() {
  const { t } = useTranslation(['pages', 'common']);
  const {
    mediaLibraryServerIds: selectedServerIds,
    mediaLibraryServers,
    isLoading: serversLoading,
    refetch,
  } = useServer();
  const { apiDayParams } = useTimeRange();
  const { value: type } = useMediaType();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const genre = searchParams.get('genre');

  const {
    data,
    isLoading,
    isError,
    refetch: refetchGenres,
  } = useGenres(type, selectedServerIds, apiDayParams);
  const rows = useMemo(() => [...(data?.data ?? [])].sort((a, b) => b.plays - a.plays), [data]);
  const hourly = data?.hourly ?? [];
  const peakHour = peakHourOf(hourly);

  const openGenre = (next: string) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('genre', next);
        return params;
      },
      { state: { sheet: true } }
    );
  };

  // A sheet opened here sits on its own history entry, so closing steps back off it; one
  // reached through a ?genre= link has nothing behind it to return to.
  const closeGenre = () => {
    const state: unknown = location.state;
    if (typeof state === 'object' && state !== null && 'sheet' in state && state.sheet === true) {
      void navigate(-1);
      return;
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete('genre');
        return params;
      },
      { replace: true }
    );
  };

  if (!serversLoading && selectedServerIds.length === 0) {
    return (
      <LibraryEmptyState
        serverIds={selectedServerIds}
        servers={mediaLibraryServers}
        onComplete={refetch}
      />
    );
  }
  if (isLoading) return <GenresSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState message={t('media.genres.loadError')} onRetry={() => void refetchGenres()} />
    );
  }
  if (rows.every((row) => row.itemCount === 0)) {
    return (
      <EmptyState
        icon={Tags}
        title={t('media.genres.empty.title')}
        description={t('media.genres.empty.description')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <GenreStatCards rows={rows} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ShareBars rows={rows} totals={data.totals} />
        <div className="space-y-6">
          <GenreTrends rows={rows} />
          <Card>
            <CardHeader>
              <CardTitle>{t('userDetail.overview.byHour')}</CardTitle>
            </CardHeader>
            <CardContent>
              {peakHour === null ? (
                <p className="text-muted-foreground text-sm">{t('common:empty.noPlayData')}</p>
              ) : (
                <HourStrip
                  data={hourly}
                  peakHour={peakHour}
                  peakLabel={t('userDetail.overview.peak', { hour: formatHour(peakHour) })}
                  label={t('userDetail.overview.byHour')}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('media.genres.table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <GenresTable rows={rows} onSelect={openGenre} />
        </CardContent>
      </Card>

      <GenreSheet
        genre={genre}
        type={type}
        serverIds={selectedServerIds}
        timeRange={apiDayParams}
        comparePeakHour={peakHour}
        onClose={closeGenre}
      />
    </div>
  );
}
