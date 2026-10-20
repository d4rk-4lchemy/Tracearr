import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ isAuthenticated: false, isSignedOut: false, isLoading: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

import { ProtectedRoute } from './ProtectedRoute';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="login" element={<p>login page</p>} />
        <Route
          path="settings"
          element={
            <ProtectedRoute>
              <p>settings page</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('renders the page for a signed-in user', () => {
    Object.assign(auth, { isAuthenticated: true, isSignedOut: false, isLoading: false });
    renderRoute();

    expect(screen.getByText('settings page')).toBeInTheDocument();
  });

  it('sends a signed-out user to the login page', () => {
    Object.assign(auth, { isAuthenticated: false, isSignedOut: true, isLoading: false });
    renderRoute();

    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('waits instead of redirecting when the session check has no answer yet', () => {
    // A rate-limited or paused /auth/me leaves no user and no loading flag
    Object.assign(auth, { isAuthenticated: false, isSignedOut: false, isLoading: false });
    renderRoute();

    expect(screen.queryByText('login page')).toBeNull();
    expect(screen.queryByText('settings page')).toBeNull();
  });
});
