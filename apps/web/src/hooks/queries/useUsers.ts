import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MERGE_SAME_SERVER_CONFIRMATION_REQUIRED } from '@tracearr/shared';
import { api } from '@/lib/api';

export function useUsers(params: { page?: number; pageSize?: number; serverId?: string } = {}) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: () => api.users.list(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: () => api.users.get(id),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Aggregate endpoint that fetches all user data in one request.
 * Use this for the UserDetail page instead of multiple separate queries.
 * Reduces 6 API calls to 1, significantly improving load time.
 */
export function useUserFull(id: string) {
  return useQuery({
    queryKey: ['users', 'full', id],
    queryFn: () => api.users.getFull(id),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useUserSessions(id: string, params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['users', 'sessions', id, params],
    queryFn: () => api.users.sessions(id, params),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { trustScore?: number } }) =>
      api.users.update(id, data),
    onSuccess: (data, variables) => {
      // Update user in cache
      queryClient.setQueryData(['users', 'detail', variables.id], data);
      // Invalidate users list and full user detail
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['users', 'full', variables.id] });
    },
  });
}

export function useUpdateUserIdentity() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) =>
      api.users.updateIdentity(id, { name }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['users', 'full', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] });
      toast.success(t('toast.success.displayNameUpdated.title'));
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.displayNameUpdateFailed'), { description: error.message });
    },
  });
}

export function useUserLocations(id: string) {
  return useQuery({
    queryKey: ['users', 'locations', id],
    queryFn: () => api.users.locations(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUserDevices(id: string) {
  return useQuery({
    queryKey: ['users', 'devices', id],
    queryFn: () => api.users.devices(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUserTerminations(id: string, params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ['users', 'terminations', id, params],
    queryFn: () => api.users.terminations(id, params),
    enabled: !!id,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useBulkResetTrust() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.users.bulkResetTrust(ids),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('toast.success.trustScoresReset.title'), {
        description: t('toast.success.trustScoresReset.message', { count: data.updated }),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.trustScoresResetFailed'), { description: error.message });
    },
  });
}

export function useMergeSuggestions(enabled: boolean) {
  return useQuery({
    queryKey: ['users', 'merge-suggestions'],
    queryFn: () => api.users.mergeSuggestions(),
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useMergeUsers() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      sourceUserId: string;
      targetUserId: string;
      confirmSameServerCombine?: boolean;
    }) =>
      api.users.merge(input.sourceUserId, {
        targetUserId: input.targetUserId,
        confirmSameServerCombine: input.confirmSameServerCombine,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('toast.success.usersMerged.title'));
    },
    onError: (error: Error) => {
      // The same-server sentinel isn't a failure - callers surface the destructive
      // confirmation UI instead of a toast when they see this message.
      if (error.message === MERGE_SAME_SERVER_CONFIRMATION_REQUIRED) {
        return;
      }
      toast.error(t('toast.error.userMergeFailed'), { description: error.message });
    },
  });
}

export function useSplitServerUser() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { serverUserId: string }) => api.serverUsers.split(input.serverUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('toast.success.serverUserSplit.title'));
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.serverUserSplitFailed'), { description: error.message });
    },
  });
}
