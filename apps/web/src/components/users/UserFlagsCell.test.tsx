import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ServerUserWithIdentity } from '@tracearr/shared';
import { UserFlagsCell } from './UserFlagsCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const row = {
  id: 'su-1',
  userId: 'u-1',
  role: 'member',
  trustScore: 100,
  identityTrustScore: 100,
  pendingViolations: 0,
  identityServers: [{ id: 'server-1', name: 'One' }],
  removedAt: null,
} as unknown as ServerUserWithIdentity;

function renderFlags(overrides: Partial<ServerUserWithIdentity>) {
  return render(
    <MemoryRouter>
      <UserFlagsCell row={{ ...row, ...overrides }} />
    </MemoryRouter>
  );
}

describe('UserFlagsCell', () => {
  it('renders nothing for a clean, trusted, single-account person', () => {
    const { container } = renderFlags({});

    expect(container.firstElementChild?.childElementCount).toBe(0);
  });

  it('shows only the flags that are true', () => {
    renderFlags({
      role: 'owner',
      identityTrustScore: 70,
      pendingViolations: 3,
      identityServers: [
        { id: 'server-1', name: 'One' },
        { id: 'server-2', name: 'Two' },
      ],
      removedAt: new Date('2026-01-01'),
    });

    expect(screen.getByTitle('common:labels.serverOwner')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'pages:users.pendingLink' })).toHaveAttribute(
      'href',
      '/violations?people=u-1&status=pending'
    );
    expect(screen.getByText('pages:users.merged')).toBeInTheDocument();
    expect(screen.getByText('pages:users.mergeServerAccountRemoved')).toBeInTheDocument();
  });
});
