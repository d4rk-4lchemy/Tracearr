import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authClient } from '@/lib/authClient';
import { BASE_URL } from '@/lib/basePath';

// Both transitions end in a full navigation so the auth query and the socket restart as the new user.
export async function stopViewingAs(queryClient: QueryClient, fallbackMessage: string) {
  // A request still in flight when the session switches back would sign the owner out (better-auth#11622)
  await queryClient.cancelQueries();
  const { error } = await authClient.admin.stopImpersonating();
  if (error) throw new Error(error.message ?? fallbackMessage);
  queryClient.clear();
  window.location.href = `${BASE_URL}users`;
}

export function useViewAs() {
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await authClient.admin.impersonateUser({ userId });
      if (error) throw new Error(error.message ?? t('errors.generic'));
    },
    onSuccess: () => {
      window.location.href = BASE_URL;
    },
  });
}

export function useStopViewingAs() {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => stopViewingAs(queryClient, t('errors.generic')),
  });
}
