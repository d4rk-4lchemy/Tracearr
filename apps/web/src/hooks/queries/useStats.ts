import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { serverScopeFromIds, serverScopeKey } from '@tracearr/shared';
import type { MediaType, DeviceCompatibilityMatrix, PeopleRank } from '@tracearr/shared';
import {
  api,
  type PlaysBreakdownOptions,
  type PlaysGroupBy,
  type StatsTimeRange,
  getBrowserTimezone,
} from '@/lib/api';

// Re-export for backwards compatibility and convenience
export type { StatsTimeRange };

export function useDashboardStats(
  serverIds: string[],
  options?: { enabled?: boolean; keepPrevious?: boolean }
) {
  // Include timezone in cache key since "today" varies by timezone
  const timezone = getBrowserTimezone();
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'dashboard', serverIdsKey, timezone],
    queryFn: () => api.stats.dashboard(serverIds.length ? serverIds : undefined),
    enabled: options?.enabled,
    placeholderData: options?.keepPrevious ? keepPreviousData : undefined,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // 1 minute
  });
}

export function useMyStats() {
  const timezone = getBrowserTimezone();
  return useQuery({
    queryKey: ['stats', 'me', timezone],
    queryFn: () => api.stats.me(),
    staleTime: 1000 * 60, // 1 minute, the server's cache window
  });
}

/** The viewer's most watched titles of the last 30 days, as poster rows. */
export function useMyTopTitles(serverIds: string[]) {
  const serverIdsKey = [...serverIds].sort().join(',');
  return useQuery({
    queryKey: ['stats', 'me', 'titles', serverIdsKey],
    queryFn: () => api.stats.myTitles(serverIds),
    enabled: serverIds.length > 0,
    staleTime: 1000 * 60,
  });
}

export function usePlaysStats(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  options?: { groupBy?: PlaysGroupBy }
) {
  // Include timezone in cache key since plays are grouped by local day
  const timezone = getBrowserTimezone();
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  const groupBy = options?.groupBy;
  return useQuery({
    queryKey: ['stats', 'plays', timeRange, serverIdsKey, timezone, groupBy],
    queryFn: () => api.stats.plays(timeRange ?? { period: 'week' }, serverIds, groupBy),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export interface LocationStatsFilters {
  timeRange?: StatsTimeRange;
  serverUserId?: string;
  serverUserIds?: string[];
  serverIds?: string[];
  mediaType?: 'movie' | 'episode' | 'track';
}

export function useLocationStats(filters?: LocationStatsFilters) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(filters?.serverIds));
  const serverUserIdsKey = filters?.serverUserIds?.length
    ? [...filters.serverUserIds].sort().join(',')
    : undefined;
  return useQuery({
    queryKey: [
      'stats',
      'locations',
      serverIdsKey,
      filters?.serverUserId,
      serverUserIdsKey,
      filters?.mediaType,
      filters?.timeRange,
    ],
    queryFn: () => api.stats.locations(filters),
    staleTime: 1000 * 60, // 1 minute
  });
}

export function usePlaysByDayOfWeek(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  options: PlaysBreakdownOptions = {}
) {
  // Include timezone in cache key since day-of-week varies by timezone
  const timezone = getBrowserTimezone();
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  const { self = false, groupBy } = options;
  return useQuery({
    queryKey: ['stats', 'plays-by-dayofweek', timeRange, serverIdsKey, timezone, self, groupBy],
    queryFn: () =>
      api.stats.playsByDayOfWeek(timeRange ?? { period: 'month' }, serverIds, { self, groupBy }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePlaysByHourOfDay(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  options: PlaysBreakdownOptions = {}
) {
  // Include timezone in cache key since hour-of-day varies by timezone
  const timezone = getBrowserTimezone();
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  const { self = false, groupBy } = options;
  return useQuery({
    queryKey: ['stats', 'plays-by-hourofday', timeRange, serverIdsKey, timezone, self, groupBy],
    queryFn: () =>
      api.stats.playsByHourOfDay(timeRange ?? { period: 'month' }, serverIds, { self, groupBy }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePlatformStats(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'platforms', timeRange, serverIdsKey],
    queryFn: () => api.stats.platforms(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useQualityStats(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'quality', timeRange, serverIdsKey],
    queryFn: () => api.stats.quality(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePeople(
  timeRange: StatsTimeRange,
  serverIds: string[],
  opts: { rank?: PeopleRank; page?: number; pageSize?: number; search?: string } = {}
) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'people', timeRange, serverIdsKey, opts, getBrowserTimezone()],
    queryFn: () => api.stats.people(timeRange, serverIds, opts),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useTopContent(timeRange?: StatsTimeRange, serverIds?: string[], self = false) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'top-content', timeRange, serverIdsKey, self],
    queryFn: () => api.stats.topContent(timeRange ?? { period: 'month' }, serverIds, self),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useConcurrentStats(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'concurrent', timeRange, serverIdsKey],
    queryFn: () => api.stats.concurrent(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export interface EngagementStatsOptions {
  mediaType?: MediaType;
  limit?: number;
  self?: boolean;
}

export function useEngagementStats(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  options?: EngagementStatsOptions
) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'engagement', timeRange, serverIdsKey, options],
    queryFn: () => api.stats.engagement(timeRange ?? { period: 'week' }, serverIds, options),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export interface ShowStatsOptions {
  limit?: number;
  orderBy?: 'totalEpisodeViews' | 'totalWatchHours' | 'bingeScore' | 'uniqueViewers';
  self?: boolean;
}

export function useShowStats(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  options?: ShowStatsOptions
) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'shows', timeRange, serverIdsKey, options],
    queryFn: () => api.stats.shows(timeRange ?? { period: 'month' }, serverIds, options),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Device compatibility stats
export function useDeviceCompatibility(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  minSessions = 5
) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'device-compatibility', timeRange, serverIdsKey, minSessions],
    queryFn: () =>
      api.stats.deviceCompatibility(timeRange ?? { period: 'month' }, serverIds, minSessions),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export interface DeviceMatrixFanOut {
  byServer: Map<
    string,
    {
      data?: DeviceCompatibilityMatrix;
      isLoading: boolean;
      error: Error | null;
      refetch: () => Promise<unknown>;
    }
  >;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
}

/** Fetch the device compatibility matrix for every selected server in one request. */
export function useDeviceCompatibilityMatrix(
  serverIds: string[],
  timeRange?: StatsTimeRange,
  minSessions = 5
): DeviceMatrixFanOut {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  const query = useQuery({
    queryKey: ['stats', 'device-compatibility-matrix', serverIdsKey, timeRange, minSessions],
    queryFn: () =>
      api.stats.deviceCompatibilityMatrixMulti(
        timeRange ?? { period: 'month' },
        serverIds,
        minSessions
      ),
    staleTime: 1000 * 60 * 5,
    enabled: serverIds.length > 0,
  });

  const byServer = new Map(
    serverIds.map((id) => [
      id,
      {
        data: query.data?.[id],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch,
      },
    ])
  );

  return {
    byServer,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

export function useDeviceHealth(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'device-health', timeRange, serverIdsKey],
    queryFn: () => api.stats.deviceHealth(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useDownloadsStats(timeRange?: StatsTimeRange, serverIds?: string[], page = 1) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'downloads', timeRange, serverIdsKey, page],
    queryFn: () => api.stats.downloads(timeRange ?? { period: 'month' }, serverIds, page),
    staleTime: 1000 * 60,
    placeholderData: keepPreviousData,
  });
}

export function useTranscodeHotspots(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'transcode-hotspots', timeRange, serverIdsKey],
    queryFn: () => api.stats.transcodeHotspots(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Bandwidth stats
export function useBandwidthDaily(
  timeRange?: StatsTimeRange,
  serverIds?: string[],
  serverUserId?: string
) {
  // Include timezone in cache key since bandwidth is grouped by local day
  const timezone = getBrowserTimezone();
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'bandwidth-daily', timeRange, serverIdsKey, serverUserId, timezone],
    queryFn: () =>
      api.stats.bandwidthDaily(timeRange ?? { period: 'month' }, serverIds, serverUserId),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useBandwidthSummary(timeRange?: StatsTimeRange, serverIds?: string[]) {
  const serverIdsKey = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery({
    queryKey: ['stats', 'bandwidth-summary', timeRange, serverIdsKey],
    queryFn: () => api.stats.bandwidthSummary(timeRange ?? { period: 'month' }, serverIds),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
