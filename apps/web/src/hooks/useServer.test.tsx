import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({
  loading: false,
  unreachable: false,
  user: null as {
    userId?: string;
    role: string;
    serverIds: string[];
    impersonatedBy?: string;
  } | null,
}));
vi.mock('./useAuth', () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: auth.loading,
    isAuthenticated: !!auth.user,
    isSignedOut: !auth.user && !auth.loading && !auth.unreachable,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: { servers: { list: vi.fn() } },
}));

import { api } from '@/lib/api';
import { ServerProvider, useServer } from './useServer';

const KEY = 'tracearr_selected_servers';
const OWNERS_PICK = JSON.stringify(['s1', 's2', 's3']);

const servers = ['s1', 's2', 's3'].map((id) => ({ id, name: id, type: 'plex' }));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServerProvider>{children}</ServerProvider>
      </QueryClientProvider>
    );
  };
}

describe('ServerProvider selection storage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(KEY, OWNERS_PICK);
    localStorage.setItem('tracearr_selected_servers_user', 'owner-1');
    auth.loading = false;
    auth.unreachable = false;
    vi.mocked(api.servers.list).mockResolvedValue(servers as never);
  });

  it('stores a pick made by the owner', async () => {
    auth.user = { role: 'owner', serverIds: [] };
    const { result } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.deselectAllExcept('s2'));

    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(['s2']));
  });

  it('keeps the owner pick intact while viewing as a member, in memory or on disk', async () => {
    auth.user = { role: 'member', serverIds: ['s1'], impersonatedBy: 'owner-1' };
    const { result } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.selectedServerIds).toEqual(['s1']));

    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);

    act(() => result.current.selectAllServers());
    act(() => result.current.deselectAllExcept('s1'));
    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);
  });

  it('scopes library queries separately and preserves the stored pick during explicit preview selections', async () => {
    vi.mocked(api.servers.list).mockResolvedValue([
      ...servers,
      { id: 'tv', name: 'Dispatcharr', type: 'dispatcharr' },
    ] as never);
    auth.user = { role: 'member', serverIds: ['s1', 'tv'], impersonatedBy: 'owner-1' };
    const { result } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setSelectedServers(['tv', 's1', 's1', 's2']));
    expect(result.current.selectedServerIds).toEqual(['tv', 's1']);
    expect(result.current.mediaLibraryServerIds).toEqual(['s1']);
    expect(result.current.mediaLibraryServers.map((s) => s.id)).toEqual(['s1']);
    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);
  });

  it('does not clear the stored pick when the preview ends and the session goes away', async () => {
    auth.user = { role: 'member', serverIds: ['s1'], impersonatedBy: 'owner-1' };
    const { result, rerender } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    auth.user = null;
    rerender();

    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);
  });

  it('still clears the pick on a normal sign-out', async () => {
    auth.user = { role: 'owner', serverIds: [] };
    const { result, rerender } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    auth.user = null;
    rerender();

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the stored pick while /me loads and the same owner comes back', async () => {
    auth.loading = true;
    auth.user = null;
    const { result, rerender } = renderHook(() => useServer(), { wrapper: wrapper() });
    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);

    auth.loading = false;
    auth.user = { userId: 'owner-1', role: 'owner', serverIds: [] };
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);
    expect(result.current.selectedServerIds).toEqual(['s1', 's2', 's3']);
  });

  it('keeps the stored pick when /me cannot be reached on load', async () => {
    auth.user = null;
    auth.unreachable = true;
    const { result } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(localStorage.getItem(KEY)).toBe(OWNERS_PICK);
  });

  it('does not hand the owner pick to a different account', async () => {
    auth.user = { userId: 'member-2', role: 'member', serverIds: ['s1', 's2'] };
    const { result } = renderHook(() => useServer(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.selectedServerIds).toEqual(['s1', 's2']));

    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(['s1', 's2']));
    expect(localStorage.getItem('tracearr_selected_servers_user')).toBe('member-2');
  });
});
