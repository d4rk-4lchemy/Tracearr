import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, createRoutesFromElements, RouterProvider } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Highcharts touches CSS.supports at import time, which jsdom does not implement.
vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts/highcharts-more', () => ({ default: () => undefined }));
vi.mock('highcharts-react-official', () => ({ HighchartsReact: () => null }));

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  user: { role: 'owner' },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

vi.mock('@/hooks/queries/useAutomations', () => ({
  useAutomation: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/components/automations/builder', () => ({
  AutomationBuilder: () => <h1>automation builder</h1>,
}));

vi.mock('@/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/queries')>()),
  usePendingViolationsCount: () => 0,
}));

vi.mock('@/pages/Dashboard', () => ({
  Dashboard: () => <h1>dashboard</h1>,
}));

vi.mock('@/pages/stats/Activity', () => ({ StatsActivity: () => <p>stats activity</p> }));
vi.mock('@/pages/stats/People', () => ({ StatsPeople: () => <p>stats people</p> }));
vi.mock('@/pages/media/Overview', () => ({ MediaOverview: () => <p>library overview</p> }));
vi.mock('@/pages/library/Genres', () => ({ LibraryGenres: () => <p>library genres</p> }));
vi.mock('@/pages/Violations', () => ({ Violations: () => <p>violations page</p> }));

vi.mock('@/components/layout/Layout', async () => {
  const { Outlet } = await import('react-router');
  return { Layout: () => <Outlet /> };
});

import { appRoutes } from './App';

function routerAt(url: string) {
  return createMemoryRouter(createRoutesFromElements(appRoutes), { initialEntries: [url] });
}

function renderAt(url: string) {
  const router = routerAt(url);
  render(<RouterProvider router={router} />);
  return router;
}

describe('App routes', () => {
  beforeEach(() => {
    auth.user.role = 'owner';
  });

  it('renders the builder page for a new automation', () => {
    renderAt('/automations/new');

    expect(screen.getByRole('heading', { name: 'automation builder' })).toBeInTheDocument();
  });

  it('still resolves the routes that were there before', () => {
    renderAt('/');

    expect(screen.getByRole('heading', { name: 'dashboard' })).toBeInTheDocument();
  });

  it('sends the old Your Stats address to the personal dashboard view', () => {
    const router = renderAt('/stats/me');

    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('?view=me');
  });

  it('lands /stats on the activity tab keeping the range', () => {
    const router = renderAt('/stats?period=week');

    expect(router.state.location.pathname).toBe('/stats/activity');
    expect(router.state.location.search).toBe('?period=week');
    expect(screen.getByText('stats activity')).toBeInTheDocument();
  });

  it('redirects /stats/users to /stats/people keeping the range', () => {
    const router = renderAt('/stats/users?period=week');

    expect(router.state.location.pathname).toBe('/stats/people');
    expect(router.state.location.search).toBe('?period=week');
    expect(screen.getByText('stats people')).toBeInTheDocument();
  });

  it.each([
    ['/media?period=year', '/library', 'library overview'],
    ['/media/genres?period=year', '/library/genres', 'library genres'],
  ])('redirects %s into the library section', (url, pathname, page) => {
    const router = renderAt(url);

    expect(router.state.location.pathname).toBe(pathname);
    expect(router.state.location.search).toBe('?period=year');
    expect(screen.getByRole('heading', { name: 'pages:library.title' })).toBeInTheDocument();
    expect(screen.getByText(page)).toBeInTheDocument();
  });

  it('redirects /stats/library to the library section keeping the range', () => {
    const router = renderAt('/stats/library?period=week');

    expect(router.state.location.pathname).toBe('/library');
    expect(router.state.location.search).toBe('?period=week');
  });

  it.each([
    ['/library/quality', 'pages:library.title'],
    ['/stats/bogus', 'nav:stats'],
    ['/stats/devices', 'nav:stats'],
  ])('gives a member the 404 under the section header at %s', (url, heading) => {
    auth.user.role = 'member';
    renderAt(url);

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders a staff-only stats tab for a member the same as a mistyped one', () => {
    auth.user.role = 'member';
    const missing = render(<RouterProvider router={routerAt('/stats/bogus')} />);
    const bogus = missing.container.innerHTML;
    missing.unmount();

    const { container } = render(<RouterProvider router={routerAt('/stats/devices')} />);
    expect(container.innerHTML).toBe(bogus);
  });

  it('renders /violations inside the Automations layout', () => {
    renderAt('/violations');

    expect(screen.getByRole('heading', { name: 'pages:automations.title' })).toBeInTheDocument();
    expect(screen.getByText('violations page')).toBeInTheDocument();
  });

  it('renders the builder page for an existing automation', () => {
    renderAt('/automations/7fd0f2e1/edit');

    expect(screen.getByRole('heading', { name: 'automation builder' })).toBeInTheDocument();
  });

  it.each([
    '/settings/general/appearance',
    '/users',
    '/automations/new',
    '/stats/users',
    '/violations',
    '/debug',
  ])('gives a member the same 404 as a mistyped URL at %s', (url) => {
    auth.user.role = 'member';
    renderAt(url);

    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('lets an admin into the management pages but not the owner debug page', () => {
    auth.user.role = 'admin';
    renderAt('/automations/new');
    expect(screen.getByRole('heading', { name: 'automation builder' })).toBeInTheDocument();
  });

  it('keeps the debug page to the owner', () => {
    auth.user.role = 'admin';
    renderAt('/debug');

    expect(screen.getByText('404')).toBeInTheDocument();
  });
});
