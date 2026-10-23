/**
 * React Query hooks for library statistics endpoints
 *
 * All hooks follow the same patterns:
 * - 5-minute staleTime (library data updates daily)
 * - Timezone included in queryKey for endpoints that use it
 * - Consistent queryKey structure: ['library', endpoint, ...params, timezone?]
 */

import { useQuery } from '@tanstack/react-query';
import { serverScopeFromIds, serverScopeKey } from '@tracearr/shared';
import { api } from '@/lib/api';
import { browserTimeZone } from '@/lib/dateFormat';
import type { ApiLibraryParams } from '@/hooks/useTimeRange';
import type { LibraryStatusResponse } from '@/lib/api';
import type {
  LibraryStatsResponse,
  LibraryGrowthResponse,
  LibraryQualityResponse,
  LibraryStorageResponse,
  DuplicatesResponse,
  DuplicateFilesResponse,
  StaleResponse,
  WatchResponse,
  PatternsResponse,
  RoiResponse,
  LibraryRoiQueryInput,
  TopMoviesResponse,
  TopShowsResponse,
  LibraryCodecsResponse,
  LibraryResolutionResponse,
} from '@tracearr/shared';

// 5 minutes - library data is updated once daily
const LIBRARY_STALE_TIME = 1000 * 60 * 5;

/**
 * Fetch current library statistics (item counts, size, quality breakdown).
 * Backend deduplicates item counts and sums storage across servers.
 */
export function useLibraryStats(serverIds: string[], libraryId?: string | null) {
  const timezone = browserTimeZone();
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<LibraryStatsResponse>({
    queryKey: ['library', 'stats', sortedIds, libraryId, timezone],
    queryFn: () => api.library.stats(serverIds, libraryId ?? undefined),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch library growth timeline (additions/removals over time).
 * Each data point carries a serverId; Overview aggregates across servers before charting.
 */
export function useLibraryGrowth(
  serverIds: string[],
  libraryId?: string | null,
  period: string = '30d',
  startDate?: string,
  endDate?: string
) {
  const timezone = browserTimeZone();
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<LibraryGrowthResponse>({
    queryKey: ['library', 'growth', sortedIds, libraryId, period, startDate, endDate, timezone],
    queryFn: () =>
      api.library.growth(serverIds, libraryId ?? undefined, period, startDate, endDate),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/** Fetch library quality evolution (resolution breakdown over time) */
export function useLibraryQuality(
  serverId?: string | null,
  period: string = '30d',
  mediaType: LibraryQualityResponse['mediaType'] = 'all',
  enabled: boolean = true,
  startDate?: string,
  endDate?: string
) {
  const timezone = browserTimeZone();
  return useQuery<LibraryQualityResponse>({
    queryKey: ['library', 'quality', serverId, period, mediaType, timezone, startDate, endDate],
    queryFn: () =>
      api.library.quality(serverId ?? undefined, period, mediaType, startDate, endDate),
    staleTime: LIBRARY_STALE_TIME,
    enabled,
  });
}

/**
 * Fetch storage analytics over the whole server selection in one request, so
 * the server-side mirror dedup spans servers. Used for the combined KPI;
 * per-server charts keep the fan-out.
 */
export function useLibraryStorageScoped(
  serverIds: string[],
  period: string = '30d',
  enabled: boolean = true,
  startDate?: string,
  endDate?: string
) {
  const timezone = browserTimeZone();
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<LibraryStorageResponse>({
    queryKey: ['library', 'storage', 'scoped', sortedIds, period, timezone, startDate, endDate],
    queryFn: () => api.library.storageScoped(serverIds, period, startDate, endDate),
    staleTime: LIBRARY_STALE_TIME,
    enabled: enabled && serverIds.length > 0,
  });
}

/**
 * Fetch cross-server duplicate detection results
 * @param enabled - Set to false to skip fetching (e.g., when only one server is selected)
 */
export function useLibraryDuplicates(
  serverIds: string[],
  page: number = 1,
  pageSize: number = 20,
  enabled: boolean = true
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<DuplicatesResponse>({
    queryKey: ['library', 'duplicates', sortedIds, page, pageSize],
    queryFn: () => api.library.duplicates(serverIds, page, pageSize),
    staleTime: LIBRARY_STALE_TIME,
    enabled,
  });
}

/**
 * Ask the media server whether a duplicate group's files are still there.
 * Enabled per expanded group, so nothing is probed until someone looks.
 */
export function useDuplicateFiles(itemIds: string[], enabled: boolean) {
  const key = itemIds.slice().sort().join(',');
  return useQuery<DuplicateFilesResponse>({
    queryKey: ['library', 'duplicate-files', key],
    queryFn: () => api.library.duplicateFiles(itemIds),
    staleTime: 60_000,
    enabled: enabled && itemIds.length > 0,
  });
}

/**
 * Fetch stale/unwatched content analysis - combined across all selected servers.
 */
export function useLibraryStale(
  serverIds: string[],
  libraryId?: string | null,
  staleDays: number = 90,
  category: 'all' | 'never_watched' | 'stale' = 'all',
  page: number = 1,
  pageSize: number = 20,
  mediaType?: 'movie' | 'show' | 'artist',
  sortBy: 'size' | 'title' | 'days_stale' | 'added_at' = 'size',
  sortOrder: 'asc' | 'desc' = 'desc'
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<StaleResponse>({
    queryKey: [
      'library',
      'stale',
      sortedIds,
      libraryId,
      staleDays,
      category,
      page,
      pageSize,
      mediaType,
      sortBy,
      sortOrder,
    ],
    queryFn: () =>
      api.library.stale(
        serverIds,
        libraryId ?? undefined,
        staleDays,
        category,
        page,
        pageSize,
        mediaType,
        sortBy,
        sortOrder
      ),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch the Watch tab summary for the picked range across one or more servers.
 * Titles are counted once by media identity and watch time is summed.
 */
export function useLibraryWatch(
  serverIds: string[],
  libraryId: string | null,
  range: ApiLibraryParams
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  const { period, startDate, endDate } = range;
  return useQuery<WatchResponse>({
    queryKey: ['library', 'watch', sortedIds, libraryId, period, startDate, endDate],
    queryFn: () => api.library.watch(serverIds, libraryId ?? undefined, range),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch watch patterns for the picked range (binge shows, peak times, viewing trend)
 * across one or more servers. BingeShow rows are deduped by show.
 */
export function useLibraryPatterns(
  serverIds: string[],
  libraryId: string | null,
  range: ApiLibraryParams
) {
  const timezone = browserTimeZone();
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  const { period, startDate, endDate } = range;
  return useQuery<PatternsResponse>({
    queryKey: ['library', 'patterns', sortedIds, libraryId, period, startDate, endDate, timezone],
    queryFn: () => api.library.patterns(serverIds, libraryId ?? undefined, range),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch content ROI analysis - combined across all selected servers.
 */
export function useLibraryRoi(
  serverIds: string[],
  libraryId: string | null,
  period: string,
  startDate: string | undefined,
  endDate: string | undefined,
  page: number = 1,
  pageSize: number = 20,
  mediaType?: 'movie' | 'show',
  sortBy: LibraryRoiQueryInput['sortBy'] = 'watch_hours_per_gb',
  sortOrder: 'asc' | 'desc' = 'desc'
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<RoiResponse>({
    queryKey: [
      'library',
      'roi',
      sortedIds,
      libraryId,
      period,
      startDate,
      endDate,
      page,
      pageSize,
      mediaType,
      sortBy,
      sortOrder,
    ],
    queryFn: () =>
      api.library.roi(
        serverIds,
        libraryId ?? undefined,
        period,
        startDate,
        endDate,
        page,
        pageSize,
        mediaType,
        sortBy,
        sortOrder
      ),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch top movies by engagement metrics across one or more servers.
 */
export function useTopMovies(
  serverIds: string[],
  period: string = '30d',
  sortBy: string = 'plays',
  sortOrder: string = 'desc',
  page: number = 1,
  pageSize: number = 20,
  startDate?: string,
  endDate?: string
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<TopMoviesResponse>({
    queryKey: [
      'library',
      'top-movies',
      sortedIds,
      period,
      sortBy,
      sortOrder,
      page,
      pageSize,
      startDate,
      endDate,
    ],
    queryFn: () =>
      api.library.topMovies(
        serverIds,
        period,
        sortBy,
        sortOrder,
        page,
        pageSize,
        startDate,
        endDate
      ),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch top TV shows by engagement metrics across one or more servers.
 */
export function useTopShows(
  serverIds: string[],
  period: string = '30d',
  sortBy: string = 'plays',
  sortOrder: string = 'desc',
  page: number = 1,
  pageSize: number = 20,
  startDate?: string,
  endDate?: string
) {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  return useQuery<TopShowsResponse>({
    queryKey: [
      'library',
      'top-shows',
      sortedIds,
      period,
      sortBy,
      sortOrder,
      page,
      pageSize,
      startDate,
      endDate,
    ],
    queryFn: () =>
      api.library.topShows(
        serverIds,
        period,
        sortBy,
        sortOrder,
        page,
        pageSize,
        startDate,
        endDate
      ),
    staleTime: LIBRARY_STALE_TIME,
    enabled: serverIds.length > 0,
  });
}

/**
 * Fetch codec distribution for library items
 */
export function useLibraryCodecs(serverId?: string | null, libraryId?: string | null) {
  return useQuery<LibraryCodecsResponse>({
    queryKey: ['library', 'codecs', serverId, libraryId],
    queryFn: () => api.library.codecs(serverId ?? undefined, libraryId ?? undefined),
    staleTime: LIBRARY_STALE_TIME,
  });
}

/**
 * Fetch resolution distribution for library items (movies vs TV)
 */
export function useLibraryResolution(serverId?: string | null, libraryId?: string | null) {
  return useQuery<LibraryResolutionResponse>({
    queryKey: ['library', 'resolution', serverId, libraryId],
    queryFn: () => api.library.resolution(serverId ?? undefined, libraryId ?? undefined),
    staleTime: LIBRARY_STALE_TIME,
  });
}

export type { LibraryStatusResponse } from '@/lib/api';

export interface LibraryStatusFanOut {
  byServer: Map<string, { data?: LibraryStatusResponse; isLoading: boolean }>;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
}

/** Fetch sync/backfill status for every selected server in one request. */
export function useLibraryStatus(serverIds: string[]): LibraryStatusFanOut {
  const sortedIds = serverScopeKey(serverScopeFromIds(serverIds));
  const query = useQuery<Record<string, LibraryStatusResponse>>({
    queryKey: ['library', 'status', sortedIds],
    queryFn: () => api.library.status(serverIds),
    staleTime: 1000 * 30,
    enabled: serverIds.length > 0,
  });

  const byServer = new Map(
    serverIds.map((id) => [id, { data: query.data?.[id], isLoading: query.isLoading }])
  );

  return {
    byServer,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
