// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerSelector } from './ServerSelector';

const useServerMock = vi.fn();

vi.mock('@/hooks/useServer', () => ({
  useServer: () => useServerMock(),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onCheckedChange?.(!checked)}
    >
      checkbox
    </button>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>loading</div>,
}));

vi.mock('@/components/icons/MediaServerIcon', () => ({
  MediaServerIcon: () => <span>icon</span>,
}));

vi.mock('lucide-react', () => ({
  ChevronsUpDown: () => <span>chevrons</span>,
}));

const makeServer = (id: string, name: string, type: 'jellyfin' | 'dispatcharr' = 'jellyfin') => ({
  id,
  name,
  type,
  color: null,
});

function buildUseServerValue(overrides: Record<string, unknown> = {}) {
  return {
    servers: [makeServer('s1', 'One'), makeServer('s2', 'Two')],
    selectedServerIds: ['s1'],
    selectedServers: [makeServer('s1', 'One')],
    isMultiServer: false,
    isAllServersSelected: false,
    toggleServer: vi.fn(),
    setSelectedServers: vi.fn(),
    selectAllServers: vi.fn(),
    deselectAllExcept: vi.fn(),
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    selectedServerId: 's1',
    selectedServer: makeServer('s1', 'One'),
    selectServer: vi.fn(),
    ...overrides,
  };
}

describe('ServerSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading skeleton while server data is loading', () => {
    useServerMock.mockReturnValue(
      buildUseServerValue({
        servers: [],
        selectedServers: [],
        isLoading: true,
      })
    );

    render(<ServerSelector />);

    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('renders a static label when only one server is available', () => {
    useServerMock.mockReturnValue(
      buildUseServerValue({
        servers: [makeServer('s1', 'Only Server', 'dispatcharr')],
        selectedServerIds: ['s1'],
        selectedServers: [makeServer('s1', 'Only Server', 'dispatcharr')],
      })
    );

    render(<ServerSelector />);

    expect(screen.getByText('Only Server')).toBeTruthy();
    expect(screen.queryByText('All servers')).toBeNull();
  });

  it('shows the selected server name in the trigger for single selection', () => {
    useServerMock.mockReturnValue(buildUseServerValue());

    render(<ServerSelector />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.textContent).toContain('One');
  });

  it('shows the all-servers label when all servers are selected', () => {
    const servers = [makeServer('s1', 'One'), makeServer('s2', 'Two')];

    useServerMock.mockReturnValue(
      buildUseServerValue({
        servers,
        selectedServerIds: ['s1', 's2'],
        selectedServers: servers,
        isMultiServer: true,
        isAllServersSelected: true,
        selectedServerId: null,
        selectedServer: null,
      })
    );

    render(<ServerSelector />);

    expect(screen.getByText('All servers')).toBeTruthy();
  });

  it('calls selectAllServers from the action row when not all servers are selected', () => {
    const selectAllServers = vi.fn();

    useServerMock.mockReturnValue(
      buildUseServerValue({
        selectAllServers,
      })
    );

    render(<ServerSelector />);
    fireEvent.click(screen.getByText('Select all'));

    expect(selectAllServers).toHaveBeenCalledTimes(1);
  });

  it('calls deselectAllExcept with the first server when all servers are selected', () => {
    const deselectAllExcept = vi.fn();
    const servers = [makeServer('s1', 'One'), makeServer('s2', 'Two')];

    useServerMock.mockReturnValue(
      buildUseServerValue({
        servers,
        selectedServerIds: ['s1', 's2'],
        selectedServers: servers,
        isMultiServer: true,
        isAllServersSelected: true,
        deselectAllExcept,
        selectedServerId: null,
        selectedServer: null,
      })
    );

    render(<ServerSelector />);
    fireEvent.click(screen.getByText('Deselect all'));

    expect(deselectAllExcept).toHaveBeenCalledWith('s1');
  });

  it('calls toggleServer when a server checkbox is toggled', () => {
    const toggleServer = vi.fn();

    useServerMock.mockReturnValue(
      buildUseServerValue({
        toggleServer,
      })
    );

    render(<ServerSelector />);
    fireEvent.click(screen.getAllByText('checkbox')[1]!);

    expect(toggleServer).toHaveBeenCalledWith('s2');
  });
});
