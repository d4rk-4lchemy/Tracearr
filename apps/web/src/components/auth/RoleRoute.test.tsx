import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const auth = vi.hoisted(() => ({ user: null as { role: string } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));

import { RoleRoute } from './RoleRoute';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route element={<RoleRoute roles={['owner', 'admin']} />}>
          <Route path="secret" element={<p>secret page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('RoleRoute', () => {
  it('renders the page for a listed role', () => {
    auth.user = { role: 'admin' };
    renderRoute();

    expect(screen.getByText('secret page')).toBeInTheDocument();
  });

  it('renders the not-found page for any other role', () => {
    auth.user = { role: 'member' };
    renderRoute();

    expect(screen.queryByText('secret page')).toBeNull();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders nothing while there is no user', () => {
    auth.user = null;
    const { container } = renderRoute();

    expect(container).toBeEmptyDOMElement();
  });
});
