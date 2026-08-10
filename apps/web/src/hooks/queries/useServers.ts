import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SERVER_STATS_CONFIG,
  BANDWIDTH_STATS_CONFIG,
  type Server,
  type ServerResourceDataPoint,
  type ServerBandwidthDataPoint,
} from '@tracearr/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMultiServerQuery } from '@/hooks/useMultiServerQuery';
import { useRef, useCallback, useEffect } from 'react';

export function useServers() {
  return useQuery({
    queryKey: ['servers', 'list'],
    queryFn: api.servers.list,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useCreateServer() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      type: string;
      url: string;
      token?: string;
      username?: string;
      password?: string;
      ignoreAnonymousStreams?: boolean;
    }) =>
      api.servers.create(data),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      toast.success(t('toast.success.serverAdded.title'), {
        description: t('toast.success.serverAdded.message', { name: variables.name }),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.serverAddFailed'), { description: error.message });
    },
  });
}

export function useDeleteServer() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.servers.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      toast.success(t('toast.success.serverRemoved.title'), {
        description: t('toast.success.serverRemoved.message'),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.serverRemoveFailed'), { description: error.message });
    },
  });
}

export function useUpdateServer() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name,
      url,
      clientIdentifier,
      token,
      username,
      password,
      ignoreAnonymousStreams,
      color,
    }: {
      id: string;
      name?: string;
      url?: string;
      clientIdentifier?: string;
      token?: string;
      username?: string;
      password?: string;
      ignoreAnonymousStreams?: boolean;
      color?: string | null;
    }) =>
      api.servers.update(id, {
        name,
        url,
        clientIdentifier,
        token,
        username,
        password,
        ignoreAnonymousStreams,
        color,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['plex', 'server-connections'] });
      toast.success(t('toast.success.serverUpdated.title'), {
        description: t('toast.success.serverUpdated.message'),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.serverUpdateFailed'), { description: error.message });
    },
  });
}

/** @deprecated Use useUpdateServer */
export function useUpdateServerUrl() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      url,
      clientIdentifier,
    }: {
      id: string;
      url: string;
      clientIdentifier?: string;
    }) => api.servers.update(id, { url, clientIdentifier }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['plex', 'server-connections'] });
      toast.success(t('toast.success.serverUrlUpdated.title'), {
        description: t('toast.success.serverUrlUpdated.message'),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.serverUrlUpdateFailed'), { description: error.message });
    },
  });
}

/**
 * Hook for fetching available connections for an existing Plex server
 * Used when editing the server URL to show available connection options
 */
export function usePlexServerConnections(serverId: string | undefined) {
  return useQuery({
    queryKey: ['plex', 'server-connections', serverId],
    queryFn: async () => {
      if (!serverId) throw new Error('serverId required');
      return api.auth.getPlexServerConnections(serverId);
    },
    enabled: !!serverId,
    staleTime: 1000 * 30, // 30 seconds - connections may change
    retry: 1,
  });
}

export function useSyncServer() {
  const { t } = useTranslation(['notifications', 'common']);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.servers.sync(id),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] });

      // Show detailed results
      const parts: string[] = [];
      if (data.usersAdded > 0) parts.push(t('common:count.usersAdded', { count: data.usersAdded }));
      if (data.usersUpdated > 0)
        parts.push(t('common:count.usersUpdated', { count: data.usersUpdated }));
      if (data.librariesSynced > 0)
        parts.push(t('common:count.library', { count: data.librariesSynced }));
      if (data.errors.length > 0)
        parts.push(t('common:count.error', { count: data.errors.length }));

      const description =
        parts.length > 0 ? parts.join(', ') : t('common:messages.noChangesDetected');

      if (data.errors.length > 0) {
        toast.warning(t('notifications:toast.success.syncCompletedWithErrors.title'), {
          description,
        });
        // Log errors to console for debugging
        console.error('Sync errors:', data.errors);
      } else {
        toast.success(t('notifications:toast.success.serverSynced.title'), { description });
      }
    },
    onError: (error: Error) => {
      toast.error(t('notifications:toast.error.serverSyncFailed'), { description: error.message });
    },
  });
}

export function useReorderServers() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOrderRef = useRef<{ id: string; displayOrder: number }[] | null>(null);

  const mutation = useMutation({
    mutationFn: (servers: { id: string; displayOrder: number }[]) => api.servers.reorder(servers),
    onMutate: async (newOrder) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['servers', 'list'] });

      // Snapshot the previous value
      const previousServers = queryClient.getQueryData<Server[]>(['servers', 'list']);

      // Optimistically update to the new value
      if (previousServers) {
        const reordered = [...previousServers].sort((a, b) => {
          const aOrder = newOrder.find((s) => s.id === a.id)?.displayOrder ?? 0;
          const bOrder = newOrder.find((s) => s.id === b.id)?.displayOrder ?? 0;
          return aOrder - bOrder;
        });
        queryClient.setQueryData(['servers', 'list'], reordered);
      }

      // Return context with the previous servers
      return { previousServers };
    },
    onError: (error: Error, _newOrder, context) => {
      // Rollback on error
      if (context?.previousServers) {
        queryClient.setQueryData(['servers', 'list'], context.previousServers);
      }
      toast.error(t('toast.error.serverReorderFailed'), { description: error.message });
    },
    onSuccess: () => {
      // Invalidate to ensure we have the latest data
      void queryClient.invalidateQueries({ queryKey: ['servers', 'list'] });
    },
  });

  // Cleanup debounce timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Use ref to avoid stale closure issues with mutation
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  // Debounced mutation function to avoid excessive API calls during drag
  const debouncedMutate = useCallback(
    (servers: { id: string; displayOrder: number }[]) => {
      // Store pending order in ref to use latest value when timer fires
      pendingOrderRef.current = servers;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        if (pendingOrderRef.current) {
          mutateRef.current(pendingOrderRef.current);
          pendingOrderRef.current = null;
        }
      }, 500);
    },
    [] // No dependencies - uses refs to avoid stale closures
  );

  return {
    ...mutation,
    mutate: debouncedMutate,
  };
}

// Merge new points into a rolling window keyed by timestamp, keep the newest
// `keep` entries, and return them oldest first for chart rendering
function mergeWindow<T extends { at: number }>(
  ref: { current: Map<number, T> },
  newData: T[],
  keep: number
): T[] {
  const map = ref.current;

  for (const point of newData) {
    map.set(point.at, point);
  }

  const sorted = Array.from(map.values())
    .sort((a, b) => b.at - a.at)
    .slice(0, keep);

  ref.current = new Map(sorted.map((p) => [p.at, p]));

  return sorted.reverse();
}

/**
 * Hook for the combined live server stats (CPU/RAM + bandwidth) with fixed
 * 2-minute windows. One request per tick serves both charts; the poll
 * interval selector governs the shared cadence. X-axis is static (2m → NOW),
 * data slides through as new points arrive.
 *
 * @param serverId - Server ID to fetch stats for
 * @param enabled - Whether polling is enabled (typically tied to component mount)
 * @param pollIntervalSeconds - Override poll interval (defaults to BANDWIDTH_STATS_CONFIG)
 */
function averageOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0
    ? Math.round(present.reduce((sum, v) => sum + v, 0) / present.length)
    : null;
}

// Servers with no live-stats source (no plugin, or offline) back off to this
// cadence instead of hammering at chart speed; data appearing restores it
const EMPTY_STATS_BACKOFF_MS = 30_000;

interface LiveStatsData {
  statistics: unknown[];
  bandwidth: unknown[];
}

function liveStatsInterval(pollMs: number) {
  return (query: { state: { data?: LiveStatsData } }) => {
    const data = query.state.data;
    const empty = !data || (data.statistics.length === 0 && data.bandwidth.length === 0);
    return empty ? EMPTY_STATS_BACKOFF_MS : pollMs;
  };
}

export function useServerLiveStats(
  serverId: string | undefined,
  enabled: boolean = true,
  pollIntervalSeconds: number = BANDWIDTH_STATS_CONFIG.POLL_INTERVAL_SECONDS
) {
  const statsMapRef = useRef<Map<number, ServerResourceDataPoint>>(new Map());
  const bandwidthMapRef = useRef<Map<number, ServerBandwidthDataPoint>>(new Map());

  // A server switch must not blend the previous server's window into the next
  const lastServerIdRef = useRef(serverId);
  if (lastServerIdRef.current !== serverId) {
    lastServerIdRef.current = serverId;
    statsMapRef.current = new Map();
    bandwidthMapRef.current = new Map();
  }

  const query = useQuery({
    queryKey: ['servers', 'live-stats', serverId],
    queryFn: async () => {
      if (!serverId) throw new Error('Server ID required');
      const response = await api.servers.liveStats(serverId);
      return {
        ...response,
        statistics: mergeWindow(statsMapRef, response.statistics, SERVER_STATS_CONFIG.DATA_POINTS),
        bandwidth: mergeWindow(
          bandwidthMapRef,
          response.bandwidth,
          BANDWIDTH_STATS_CONFIG.DATA_POINTS
        ),
      };
    },
    enabled: enabled && !!serverId,
    refetchInterval: liveStatsInterval(pollIntervalSeconds * 1000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    staleTime: pollIntervalSeconds * 1000 - 500,
  });

  const statistics = query.data?.statistics;
  const statisticsAverages =
    statistics && statistics.length > 0
      ? {
          hostCpu: averageOf(statistics.map((p) => p.hostCpuUtilization)),
          processCpu: Math.round(
            statistics.reduce((sum, p) => sum + p.processCpuUtilization, 0) / statistics.length
          ),
          hostMemory: averageOf(statistics.map((p) => p.hostMemoryUtilization)),
          processMemory: Math.round(
            statistics.reduce((sum, p) => sum + p.processMemoryUtilization, 0) / statistics.length
          ),
        }
      : null;

  const bandwidth = query.data?.bandwidth;
  const bandwidthAverages =
    bandwidth && bandwidth.length > 0
      ? {
          local: Math.round(
            bandwidth.reduce((sum, p) => sum + p.lanBytes / p.timespan, 0) / bandwidth.length
          ),
          remote: Math.round(
            bandwidth.reduce((sum, p) => sum + p.wanBytes / p.timespan, 0) / bandwidth.length
          ),
        }
      : null;

  return {
    ...query,
    statistics,
    statisticsAverages,
    bandwidth,
    bandwidthAverages,
    bandwidthSamples: query.data?.bandwidthSamples,
    bandwidthAccounts: query.data?.bandwidthAccounts,
    bandwidthDevices: query.data?.bandwidthDevices,
  };
}

export interface ServerLiveStatsSeries {
  serverId: string;
  statistics: ServerResourceDataPoint[];
  bandwidth: ServerBandwidthDataPoint[];
}

/**
 * Live stats for several servers at once, one query per server sharing the
 * single-server cache keys. Each server accumulates its own rolling window.
 *
 * @param serverIds - Servers to poll (Plex only; others return 400 and are
 *   surfaced as empty series)
 * @param enabled - Whether polling is enabled
 * @param pollIntervalSeconds - Shared poll cadence for all servers
 */
export function useMultiServerLiveStats(
  serverIds: string[],
  enabled: boolean = true,
  pollIntervalSeconds: number = BANDWIDTH_STATS_CONFIG.POLL_INTERVAL_SECONDS
) {
  const statsWindowsRef = useRef(
    new Map<string, { current: Map<number, ServerResourceDataPoint> }>()
  );
  const bandwidthWindowsRef = useRef(
    new Map<string, { current: Map<number, ServerBandwidthDataPoint> }>()
  );

  // Prune windows for deselected servers so re-adding one later starts clean
  const idsKey = serverIds.join(',');
  const lastIdsKeyRef = useRef(idsKey);
  if (lastIdsKeyRef.current !== idsKey) {
    lastIdsKeyRef.current = idsKey;
    const keep = new Set(serverIds);
    for (const store of [statsWindowsRef.current, bandwidthWindowsRef.current]) {
      for (const key of Array.from(store.keys())) {
        if (!keep.has(key)) store.delete(key);
      }
    }
  }

  const windowFor = useCallback(function <T>(
    store: Map<string, { current: Map<number, T> }>,
    serverId: string
  ): { current: Map<number, T> } {
    let ref = store.get(serverId);
    if (!ref) {
      ref = { current: new Map<number, T>() };
      store.set(serverId, ref);
    }
    return ref;
  }, []);

  const { byServer, isLoading } = useMultiServerQuery<
    Awaited<ReturnType<typeof api.servers.liveStats>>
  >(enabled ? serverIds : [], (serverId) => ({
    queryKey: ['servers', 'live-stats', serverId],
    queryFn: async () => {
      const response = await api.servers.liveStats(serverId);
      return {
        ...response,
        statistics: mergeWindow(
          windowFor(statsWindowsRef.current, serverId),
          response.statistics,
          SERVER_STATS_CONFIG.DATA_POINTS
        ),
        bandwidth: mergeWindow(
          windowFor(bandwidthWindowsRef.current, serverId),
          response.bandwidth,
          BANDWIDTH_STATS_CONFIG.DATA_POINTS
        ),
      };
    },
    refetchInterval: liveStatsInterval(pollIntervalSeconds * 1000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    staleTime: pollIntervalSeconds * 1000 - 500,
  }));

  const series: ServerLiveStatsSeries[] = serverIds.map((serverId) => {
    const result = byServer.get(serverId);
    return {
      serverId,
      statistics: result?.data?.statistics ?? [],
      bandwidth: result?.data?.bandwidth ?? [],
    };
  });

  return { series, isLoading };
}
