import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { AppSidebar } from './AppSidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({
    servers: [],
    selectedServerIds: [],
    isAllServersSelected: true,
    toggleServer: vi.fn(),
    selectAllServers: vi.fn(),
    deselectAllExcept: vi.fn(),
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ serverConnectionStatuses: new Map(), isConnected: false }),
}));

const { seerr, versionState, dismissMutate, pendingCount } = vi.hoisted(() => ({
  seerr: { configured: false },
  versionState: { data: undefined as unknown, isLoading: true },
  dismissMutate: vi.fn(),
  pendingCount: vi.fn<(enabled: boolean) => number>(),
}));

vi.mock('@/hooks/queries', () => ({
  useVersion: () => versionState,
  useRequestsConfigured: () => ({ data: seerr }),
  useDismissWhatsNew: () => ({ mutate: dismissMutate }),
  usePendingViolationsCount: pendingCount,
}));

const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'tester', email: 'tester@example.test', thumbUrl: null, role: auth.role },
    logout: vi.fn(),
  }),
}));

function renderSidebar(initialPath = '/stats/activity', defaultOpen = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <SidebarProvider defaultOpen={defaultOpen}>
            <AppSidebar />
          </SidebarProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AppSidebar navigation', () => {
  beforeEach(() => {
    auth.role = 'owner';
    seerr.configured = false;
    versionState.data = undefined;
    versionState.isLoading = true;
    dismissMutate.mockReset();
    pendingCount.mockReset();
    pendingCount.mockReturnValue(0);
  });

  it('hides the Requests entry until a Seerr is linked', () => {
    renderSidebar();

    expect(screen.queryByText('requests')).not.toBeInTheDocument();
  });

  it('shows the Requests entry once a Seerr is linked', () => {
    seerr.configured = true;
    renderSidebar();

    expect(screen.getByText('requests')).toBeInTheDocument();
  });

  it('renders nine entries, no group labels, and settings in the footer', () => {
    seerr.configured = true;
    renderSidebar();

    for (const name of [
      'dashboard',
      'map',
      'history',
      'stats',
      'library',
      'mediaBrowse',
      'requests',
      'users',
      'automations',
    ]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const label of ['monitor', 'media', 'manage']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    const settings = screen.getByRole('link', { name: 'settings' });
    expect(settings.closest('[data-sidebar="footer"]')).not.toBeNull();
  });

  it('keeps every direct child of a menu list an li, including the Users divider', () => {
    seerr.configured = true;
    const { container } = renderSidebar();

    const separator = container.querySelector('[data-sidebar="separator"]');
    expect(separator?.parentElement?.tagName).toBe('LI');
    const lists = container.querySelectorAll('[data-sidebar="menu"]');
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      for (const child of list.children) expect(child.tagName).toBe('LI');
    }
  });

  it('carries the current range onto sidebar links and drops other params', () => {
    renderSidebar('/stats/activity?period=week&view=me');

    expect(screen.getByRole('link', { name: 'library' })).toHaveAttribute(
      'href',
      '/library?period=week'
    );
  });

  it('shows the pending violation count on Automations for staff and nothing at zero', () => {
    pendingCount.mockReturnValue(3);
    const { unmount } = renderSidebar();

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('3')).toHaveClass('bg-warning/10', 'text-warning');
    expect(pendingCount).toHaveBeenCalledWith(true);
    unmount();

    pendingCount.mockReturnValue(0);
    renderSidebar();

    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-count-dot')).not.toBeInTheDocument();
  });

  it('does not fetch the count for a member', () => {
    auth.role = 'member';
    renderSidebar();

    expect(pendingCount).not.toHaveBeenCalled();
  });

  it('keeps the count as a dot when the rail is collapsed', () => {
    pendingCount.mockReturnValue(3);
    renderSidebar('/stats/activity', false);

    expect(screen.getByTestId('nav-count-dot')).toBeInTheDocument();
  });

  it('opens the release notes when the version is clicked, and closing never writes anything', () => {
    versionState.data = {
      current: {
        version: '2.2.3',
        tag: 'v2.2.3',
        commit: null,
        buildDate: null,
        isPrerelease: false,
      },
      fork: { latest: null, updateAvailable: false },
      upstream: { latest: null, updateAvailable: false },
      recommended: { kind: 'none' },
      lastChecked: null,
    };
    versionState.isLoading = false;
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /v2\.2\.3/ }));
    expect(screen.getByText('settings:whatsNew.title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common:actions.close' }));
    expect(screen.queryByText('settings:whatsNew.title')).not.toBeInTheDocument();
    expect(dismissMutate).not.toHaveBeenCalled();
  });

  it('shows a member only dashboard, map, history, stats, library, browse and requests', () => {
    auth.role = 'member';
    seerr.configured = true;
    renderSidebar();

    for (const name of [
      'dashboard',
      'map',
      'history',
      'stats',
      'library',
      'mediaBrowse',
      'requests',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const name of ['users', 'settings', 'automations']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });
});
