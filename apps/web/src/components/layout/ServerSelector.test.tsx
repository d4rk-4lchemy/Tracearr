// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerSelector } from './ServerSelector';

const useLocationMock = vi.fn();
const useServerMock = vi.fn();

vi.mock('react-router', () => ({
  useLocation: () => useLocationMock(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => useServerMock(),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: () => <input type="checkbox" readOnly />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>loading</div>,
}));

vi.mock('@/components/icons/MediaServerIcon', () => ({
  MediaServerIcon: () => <span>icon</span>,
}));

vi.mock('lucide-react', () => ({
  Check: () => <span>check</span>,
  ChevronsUpDown: () => <span>chevrons</span>,
}));

const makeServer = (id: string, name: string, type: 'jellyfin' | 'dispatcharr' = 'jellyfin') => ({
  id,
  name,
  type,
  color: null,
});

describe('ServerSelector route persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('stashes multi-selection and falls back to remembered single when leaving a multi-select route', async () => {
    const deselectAllExcept = vi.fn();
    const setSelectedServers = vi.fn();
    const servers = [makeServer('s1', 'One'), makeServer('s2', 'Two')];

    localStorage.setItem('tracearr_last_single_server', 's2');

    useLocationMock.mockReturnValue({ pathname: '/' });
    useServerMock.mockReturnValue({
      servers,
      selectedServerIds: ['s1', 's2'],
      isAllServersSelected: true,
      toggleServer: vi.fn(),
      setSelectedServers,
      selectAllServers: vi.fn(),
      deselectAllExcept,
      isLoading: false,
      isFetching: false,
    });

    const view = render(<ServerSelector />);

    useLocationMock.mockReturnValue({ pathname: '/users' });
    view.rerender(<ServerSelector />);

    await waitFor(() => {
      expect(deselectAllExcept).toHaveBeenCalledWith('s2');
    });
    expect(localStorage.getItem('tracearr_dashboard_selected_servers')).toBe('["s1","s2"]');
  });

  it('restores saved multi-selection when entering a multi-select route', async () => {
    const deselectAllExcept = vi.fn();
    const setSelectedServers = vi.fn();
    const servers = [makeServer('s1', 'One'), makeServer('s2', 'Two'), makeServer('s3', 'Three')];

    localStorage.setItem('tracearr_dashboard_selected_servers', '["s1","s3"]');

    useLocationMock.mockReturnValue({ pathname: '/users' });
    useServerMock.mockReturnValue({
      servers,
      selectedServerIds: ['s1'],
      isAllServersSelected: false,
      toggleServer: vi.fn(),
      setSelectedServers,
      selectAllServers: vi.fn(),
      deselectAllExcept,
      isLoading: false,
      isFetching: false,
    });

    const view = render(<ServerSelector />);

    useLocationMock.mockReturnValue({ pathname: '/history' });
    view.rerender(<ServerSelector />);

    await waitFor(() => {
      expect(setSelectedServers).toHaveBeenCalledWith(['s1', 's3']);
    });
  });

  it('restores saved multi-selection on an initial multi-select route load after servers hydrate', async () => {
    const deselectAllExcept = vi.fn();
    const setSelectedServers = vi.fn();
    const servers = [makeServer('s1', 'One'), makeServer('s2', 'Two'), makeServer('s3', 'Three')];

    localStorage.setItem('tracearr_dashboard_selected_servers', '["s1","s3"]');

    useLocationMock.mockReturnValue({ pathname: '/history' });
    useServerMock.mockReturnValue({
      servers: [],
      selectedServerIds: ['s2'],
      isAllServersSelected: false,
      toggleServer: vi.fn(),
      setSelectedServers,
      selectAllServers: vi.fn(),
      deselectAllExcept,
      isLoading: false,
      isFetching: true,
    });

    const view = render(<ServerSelector />);

    useServerMock.mockReturnValue({
      servers,
      selectedServerIds: ['s2'],
      isAllServersSelected: false,
      toggleServer: vi.fn(),
      setSelectedServers,
      selectAllServers: vi.fn(),
      deselectAllExcept,
      isLoading: false,
      isFetching: false,
    });
    view.rerender(<ServerSelector />);

    await waitFor(() => {
      expect(setSelectedServers).toHaveBeenCalledWith(['s1', 's3']);
    });
  });

  it('remembers single non-dashboard selection as preferred fallback', async () => {
    useLocationMock.mockReturnValue({ pathname: '/users' });
    useServerMock.mockReturnValue({
      servers: [makeServer('s1', 'One'), makeServer('s2', 'Two')],
      selectedServerIds: ['s2'],
      isAllServersSelected: false,
      toggleServer: vi.fn(),
      setSelectedServers: vi.fn(),
      selectAllServers: vi.fn(),
      deselectAllExcept: vi.fn(),
      isLoading: false,
      isFetching: false,
    });

    render(<ServerSelector />);

    await waitFor(() => {
      expect(localStorage.getItem('tracearr_last_single_server')).toBe('s2');
    });
  });
});
