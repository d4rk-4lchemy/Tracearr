import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: { servers: { locations: vi.fn(), setHistorical: vi.fn() } },
}));

import { api } from '@/lib/api';
import { useServerLocations, useSetServerHistorical } from './useServers';

const mockLocations = vi.mocked(api.servers.locations);
const mockSetHistorical = vi.mocked(api.servers.setHistorical);

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('useServerLocations', () => {
  it('refetches each time a server is opened, even when its cached locations are fresh', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    });
    client.setQueryData(['servers', 'locations', 'server-1'], { entries: [], syncPending: false });
    const saved = { effectiveFrom: null, lat: 1, lon: 2, city: null, region: null, country: 'US' };
    mockLocations.mockResolvedValue({ entries: [saved], syncPending: false });

    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useServerLocations(id),
      { initialProps: { id: undefined as string | undefined }, wrapper: wrapper(client) }
    );
    rerender({ id: 'server-1' });

    await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true));
    expect(mockLocations).toHaveBeenCalledWith('server-1');
    expect(result.current.data?.entries).toEqual([saved]);
  });
});

describe('useSetServerHistorical', () => {
  it('refetches the server list when the switch fails after the row was updated', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    mockSetHistorical.mockRejectedValue(new Error('Internal Server Error'));

    const { result } = renderHook(() => useSetServerHistorical(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 'server-1', historical: true }).catch(() => {});
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['servers', 'list'] });
  });
});
