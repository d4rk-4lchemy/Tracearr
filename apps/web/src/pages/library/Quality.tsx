import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ErrorState,
  LibraryEmptyState,
  CodecDistributionSection,
  ResolutionDistributionSection,
} from '@/components/library';
import { QualityTimelineChart } from '@/components/charts';
import { PerServerCardGrid } from '@/components/server';
import { useLibraryQuality, useLibraryStatus } from '@/hooks/queries';
import { QUALITY_MEDIA_TYPES, useMediaType } from '@/hooks/useMediaType';
import { useServer } from '@/hooks/useServer';
import { useTimeRange, type ApiLibraryParams } from '@/hooks/useTimeRange';
import type { Server } from '@tracearr/shared';

type MediaTypeFilter = (typeof QUALITY_MEDIA_TYPES)[number];

/**
 * Per-server quality evolution card rendered inside PerServerCardGrid.
 * Fetches its own data so loading is independent per server.
 */
function ServerQualityEvolutionCard({
  server,
  apiParams,
  mediaType,
  timeRangePeriod,
}: {
  server: Server;
  apiParams: ApiLibraryParams;
  mediaType: MediaTypeFilter;
  timeRangePeriod: string;
}) {
  const quality = useLibraryQuality(
    server.id,
    apiParams.period,
    mediaType,
    true,
    apiParams.startDate,
    apiParams.endDate
  );

  return (
    <QualityTimelineChart
      data={quality.data}
      isLoading={quality.isLoading}
      height={300}
      period={timeRangePeriod}
    />
  );
}

export function LibraryQuality() {
  const { t } = useTranslation(['pages', 'common']);
  const { mediaLibraryServers, mediaLibraryServerIds, isLoading: serversLoading } = useServer();
  const isMultiServer = mediaLibraryServerIds.length > 1;
  const selectedServers = mediaLibraryServers;
  const selectedServerIds = mediaLibraryServerIds;
  // When single-server, the one selected ID drives the quality/status hooks
  const singleServerId = !isMultiServer ? (selectedServerIds[0] ?? null) : null;
  const { value: timeRange, apiLibraryParams } = useTimeRange();
  const { value: mediaType } = useMediaType(QUALITY_MEDIA_TYPES);

  const serverIds = useMemo(() => selectedServers.map((s) => s.id), [selectedServers]);
  const statusResult = useLibraryStatus(serverIds);

  // Single-server quality fetch (only used for single-server error state + chart)
  const singleQuality = useLibraryQuality(
    singleServerId ?? undefined,
    apiLibraryParams.period,
    mediaType,
    !isMultiServer && selectedServerIds.length > 0,
    apiLibraryParams.startDate,
    apiLibraryParams.endDate
  );

  // Show error state for single-server only; multi-server cards handle errors independently
  if (!isMultiServer && singleQuality.isError) {
    return (
      <div className="space-y-6">
        <ErrorState
          title={t('library.quality.failedToLoad')}
          message={singleQuality.error?.message ?? t('library.quality.failedToLoadDesc')}
          onRetry={singleQuality.refetch}
        />
      </div>
    );
  }

  if (!serversLoading && selectedServerIds.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center">{t('media.noLibraryServers')}</div>
    );
  }

  // Gate on empty/setup state:
  // - Single-server: same as before - check the one server.
  // - Multi-server: only show page-level empty state if EVERY selected server needs setup.
  const needsSetup = (() => {
    if (isMultiServer) {
      // All servers need setup -> show page-level empty state
      return (
        serverIds.length > 0 &&
        serverIds.every((id) => {
          const entry = statusResult.byServer.get(id);
          if (!entry || entry.isLoading) return false;
          const d = entry.data;
          return !d?.isSynced || d?.needsBackfill || d?.isBackfillRunning;
        })
      );
    }
    if (singleServerId) {
      const entry = statusResult.byServer.get(singleServerId);
      const d = entry?.data;
      return !statusResult.isLoading && (!d?.isSynced || d?.needsBackfill || d?.isBackfillRunning);
    }
    return false;
  })();

  if (needsSetup) {
    return (
      <div className="space-y-6">
        <LibraryEmptyState
          onComplete={singleQuality.refetch}
          serverIds={selectedServerIds}
          servers={selectedServers}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quality Evolution Chart - the layout's media type and time range apply to all cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('library.quality.qualityEvolution')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isMultiServer ? (
            <PerServerCardGrid
              servers={selectedServers}
              renderServer={(server) => (
                <ServerQualityEvolutionCard
                  server={server}
                  apiParams={apiLibraryParams}
                  mediaType={mediaType}
                  timeRangePeriod={timeRange.period}
                />
              )}
            />
          ) : (
            <QualityTimelineChart
              data={singleQuality.data}
              isLoading={singleQuality.isLoading}
              height={300}
              period={timeRange.period}
            />
          )}
        </CardContent>
      </Card>

      {/* Resolution Distribution - Movies vs TV */}
      <ResolutionDistributionSection
        serverId={singleServerId}
        selectedServers={isMultiServer ? selectedServers : undefined}
        isMultiServer={isMultiServer}
      />

      {/* Codec Distribution - Full width with tabs */}
      <CodecDistributionSection
        serverId={singleServerId}
        selectedServers={isMultiServer ? selectedServers : undefined}
        isMultiServer={isMultiServer}
      />
    </div>
  );
}
