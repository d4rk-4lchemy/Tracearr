import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Retries ride out a server restart: the login page is often the first thing loaded after one. */
export function useSetupStatus(all = false) {
  return useQuery({
    queryKey: ['setup', 'status', all],
    queryFn: () => api.setup.status(all),
    retry: 2,
    retryDelay: (attempt) => (attempt + 1) * 1000,
  });
}
