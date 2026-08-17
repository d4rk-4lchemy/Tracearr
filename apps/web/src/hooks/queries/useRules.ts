import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Rule } from '@tracearr/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function useRules() {
  return useQuery({
    queryKey: ['rules', 'list'],
    queryFn: api.rules.list,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useDeleteRule() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.rules.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules', 'list'] });
      toast.success(t('toast.success.ruleDeleted.title'), {
        description: t('toast.success.ruleDeleted.message'),
      });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.ruleDeleteFailed'), { description: error.message });
    },
  });
}

export function useToggleRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.rules.update(id, { isActive }),
    onMutate: async ({ id, isActive }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['rules', 'list'] });

      // Snapshot the previous value
      const previousRules = queryClient.getQueryData<Rule[]>(['rules', 'list']);

      // Optimistically update to the new value
      queryClient.setQueryData<Rule[]>(['rules', 'list'], (old) => {
        if (!old) return [];
        return old.map((rule) => (rule.id === id ? { ...rule, isActive } : rule));
      });

      return { previousRules };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousRules) {
        queryClient.setQueryData(['rules', 'list'], context.previousRules);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules', 'list'] });
    },
  });
}

export function useBulkToggleRules() {
  const { t } = useTranslation(['notifications', 'pages', 'common']);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, isActive }: { ids: string[]; isActive: boolean }) =>
      api.rules.bulkUpdate(ids, isActive),
    onSuccess: (data, { isActive }) => {
      void queryClient.invalidateQueries({ queryKey: ['rules', 'list'] });
      const action = isActive ? t('pages:rules.enable') : t('pages:rules.disable');
      toast.success(action, {
        description: t('common:count.rule', { count: data.updated }),
      });
    },
    onError: (error: Error) => {
      toast.error(t('notifications:toast.error.ruleUpdateFailed'), { description: error.message });
    },
  });
}

export function useBulkDeleteRules() {
  const { t } = useTranslation(['notifications', 'common']);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.rules.bulkDelete(ids),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['rules', 'list'] });
      toast.success(t('notifications:toast.success.ruleDeleted.title'), {
        description: t('common:count.rule', { count: data.deleted }),
      });
    },
    onError: (error: Error) => {
      toast.error(t('notifications:toast.error.ruleDeleteFailed'), { description: error.message });
    },
  });
}
