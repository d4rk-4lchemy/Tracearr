/**
 * React Query hooks for the History page.
 * Provides infinite scroll queries and filter options.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { HistoryQueryInput, HistoryAggregatesQueryInput } from '@tracearr/shared';
import { api } from '@/lib/api';

/**
 * Filter parameters for history queries.
 * Omits cursor and pageSize as those are handled by infinite query.
 */
export interface HistoryFilters {
  serverUserIds?: string[];
  serverId?: string;
  serverIds?: string[];
  state?: 'playing' | 'paused' | 'stopped';
  mediaTypes?: ('movie' | 'episode' | 'track' | 'live')[];
  startDate?: Date;
  endDate?: Date;
  search?: string;
  platforms?: string[];
  product?: string;
  device?: string;
  playerName?: string;
  ipAddress?: string;
  geoCountries?: string[];
  geoCity?: string;
  geoRegion?: string;
  transcodeDecisions?: ('directplay' | 'copy' | 'transcode')[];
  watched?: boolean;
  excludeShortSessions?: boolean;
  orderBy?: 'startedAt' | 'durationMs' | 'mediaTitle';
  orderDir?: 'asc' | 'desc';
}

/**
 * Infinite query for history sessions with cursor-based pagination.
 * Supports all history filters and provides aggregate stats.
 */
export function useHistorySessions(filters: HistoryFilters = {}, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ['sessions', 'history', filters, pageSize],
    queryFn: async ({ pageParam }) => {
      const params: Partial<HistoryQueryInput> & { cursor?: string } = {
        ...filters,
        pageSize,
        cursor: pageParam,
      };
      return api.sessions.history(params);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Filters for aggregates query - excludes sorting/pagination params.
 * Uses the schema-derived type from shared package for consistency.
 */
export type AggregateFilters = Partial<HistoryAggregatesQueryInput>;

/**
 * Query for aggregate stats (total plays, watch time, unique users/content).
 * Called separately from useHistorySessions so sorting changes don't refetch stats.
 */
export function useHistoryAggregates(filters: AggregateFilters = {}) {
  return useQuery({
    queryKey: ['sessions', 'history', 'aggregates', filters],
    queryFn: () => api.sessions.historyAggregates(filters),
    staleTime: 1000 * 60, // 1 minute - aggregates can be cached longer
  });
}

/**
 * Query for filter options (platforms, products, devices, countries, etc.).
 * Used to populate filter dropdowns.
 * Accepts optional date range to match the current history filter.
 */
export function useFilterOptions(params?: {
  serverId?: string;
  serverIds?: string[];
  startDate?: Date;
  endDate?: Date;
}) {
  const serverIdsKey = params?.serverIds?.length ? [...params.serverIds].sort().join(',') : '';
  return useQuery({
    queryKey: [
      'sessions',
      'filter-options',
      params?.serverId,
      serverIdsKey,
      params?.startDate?.toISOString(),
      params?.endDate?.toISOString(),
    ],
    queryFn: () => api.sessions.filterOptions(params),
    staleTime: 1000 * 60 * 5, // 5 minutes - filter options don't change often
  });
}

/**
 * Query for filter options for the rules builder.
 * Returns all countries (with hasSessions indicator) and servers.
 */
export function useRulesFilterOptions() {
  return useQuery({
    queryKey: ['sessions', 'filter-options', 'rules'],
    queryFn: () => api.sessions.rulesFilterOptions(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
