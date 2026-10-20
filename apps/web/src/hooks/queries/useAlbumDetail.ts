import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useAlbumDetail(id: string, serverIds: string[], enabled = true) {
  const sortedServerIds = [...serverIds].sort();
  return useQuery({
    queryKey: ['media', 'album', id, sortedServerIds.join(',')],
    queryFn: () => api.library.media.album(id, sortedServerIds),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    enabled: enabled && serverIds.length > 0,
  });
}
