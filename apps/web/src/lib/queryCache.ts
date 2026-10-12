import type { QueryClient } from '@tanstack/react-query';

/** Everything cached for the person who was signed in, so the next one never sees it. The auth query stays: it decides who is signed in. */
export function dropUserData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
}
