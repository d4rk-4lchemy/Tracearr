import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NotificationChannelRouting, NotificationEventType } from '@tracearr/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function useChannelRouting(enabled = true) {
  return useQuery({
    queryKey: ['channelRouting'],
    queryFn: api.channelRouting.getAll,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled,
  });
}

export function useUpdateChannelRouting() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      eventType,
      ...data
    }: {
      eventType: NotificationEventType;
      discordEnabled?: boolean;
      webhookEnabled?: boolean;
      webToastEnabled?: boolean;
      pushEnabled?: boolean;
    }) => api.channelRouting.update(eventType, data),
    onMutate: async ({
      eventType,
      discordEnabled,
      webhookEnabled,
      webToastEnabled,
      pushEnabled,
    }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['channelRouting'] });

      // Snapshot the previous value
      const previousRouting = queryClient.getQueryData<NotificationChannelRouting[]>([
        'channelRouting',
      ]);

      // Optimistically update
      queryClient.setQueryData<NotificationChannelRouting[]>(['channelRouting'], (old) => {
        if (!old) return old;
        return old.map((routing) => {
          if (routing.eventType !== eventType) return routing;
          return {
            ...routing,
            ...(discordEnabled !== undefined && { discordEnabled }),
            ...(webhookEnabled !== undefined && { webhookEnabled }),
            ...(webToastEnabled !== undefined && { webToastEnabled }),
            ...(pushEnabled !== undefined && { pushEnabled }),
          };
        });
      });

      return { previousRouting };
    },
    onError: (err, _variables, context) => {
      // Rollback on error
      if (context?.previousRouting) {
        queryClient.setQueryData(['channelRouting'], context.previousRouting);
      }
      toast.error(t('toast.error.routingUpdateFailed'), { description: err.message });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channelRouting'] });
    },
  });
}
