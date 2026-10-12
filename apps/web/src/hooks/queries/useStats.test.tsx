import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: { stats: { myTitles: vi.fn().mockResolvedValue({ data: [] }) } },
}));

import { api } from '@/lib/api';
import { useMyTopTitles } from './useStats';

describe('useMyTopTitles library scope', () => {
  it('keeps an empty library selection idle and fetches only the selected library servers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(({ ids }) => useMyTopTitles(ids), {
      wrapper,
      initialProps: { ids: [] as string[] },
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.stats.myTitles).not.toHaveBeenCalled();

    rerender({ ids: ['plex-1'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.stats.myTitles).toHaveBeenCalledExactlyOnceWith(['plex-1']);
    client.clear();
  });
});
