import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth = vi.hoisted(() => ({ role: 'owner', impersonatedBy: undefined as string | undefined }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: auth.role, impersonatedBy: auth.impersonatedBy } }),
}));
vi.mock('@/hooks/useDocumentTitle', () => ({ useStreamCountTitle: () => undefined }));
vi.mock('./AppSidebar', () => ({ AppSidebar: () => null }));
vi.mock('./SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('./StatusBanners', () => ({ StatusBanners: () => null }));
vi.mock('@/components/whats-new/WhatsNewAutoOpen', () => ({
  WhatsNewAutoOpen: () => <div>release notes</div>,
}));

import { Layout } from './Layout';

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>
  );
}

describe('Layout', () => {
  beforeEach(() => {
    auth.role = 'owner';
    auth.impersonatedBy = undefined;
  });

  it.each(['owner', 'admin'])('opens the release notes for the %s', (role) => {
    auth.role = role;
    renderLayout();

    expect(screen.getByText('release notes')).toBeInTheDocument();
  });

  it('keeps the release notes away from a member, whose calls to read and dismiss them are refused', () => {
    auth.role = 'member';
    renderLayout();

    expect(screen.queryByText('release notes')).toBeNull();
  });

  it('keeps the release notes closed while viewing as an admin, where dismissing would be refused', () => {
    auth.role = 'admin';
    auth.impersonatedBy = 'owner-1';
    renderLayout();

    expect(screen.queryByText('release notes')).toBeNull();
  });
});
