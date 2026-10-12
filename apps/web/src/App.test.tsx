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

vi.mock('@/pages/Dashboard', () => ({
  Dashboard: () => <h1>dashboard</h1>,
}));

vi.mock('@/components/layout/Layout', async () => {
  const { Outlet } = await import('react-router');
  return { Layout: () => <Outlet /> };
});

import { appRoutes } from './App';

function renderAt(url: string) {
  const router = createMemoryRouter(createRoutesFromElements(appRoutes), {
    initialEntries: [url],
  });
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
