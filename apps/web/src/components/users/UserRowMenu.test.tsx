import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ServerUserWithIdentity } from '@tracearr/shared';
import { UserRowMenu } from './UserRowMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { mockViewAs } = vi.hoisted(() => ({ mockViewAs: vi.fn() }));
vi.mock('@/hooks/queries/useImpersonation', () => ({
  useViewAs: () => ({ mutate: mockViewAs, isPending: false }),
}));

const row = {
  id: 'su-1',
  userId: 'u-1',
  username: 'alice',
  identityName: 'Alice',
  role: 'member',
} as unknown as ServerUserWithIdentity;

function renderMenu(props: Partial<Parameters<typeof UserRowMenu>[0]> = {}) {
  const onEditIdentity = vi.fn();
  const onAdjustTrust = vi.fn();
  render(
    <MemoryRouter>
      <UserRowMenu
        row={row}
        isOwner
        onEditIdentity={onEditIdentity}
        onAdjustTrust={onAdjustTrust}
        {...props}
      />
    </MemoryRouter>
  );
  return { onEditIdentity, onAdjustTrust };
}

describe('UserRowMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives the owner every action and hands each the row', async () => {
    const { onAdjustTrust } = renderMenu();

    await userEvent.click(screen.getByRole('button', { name: 'pages:users.rowActions' }));
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'pages:userDetail.adjustTrustScore' })
    );
    expect(onAdjustTrust).toHaveBeenCalledWith(row);

    await userEvent.click(screen.getByRole('button', { name: 'pages:users.rowActions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'pages:userDetail.access.viewAs' }));
    expect(mockViewAs).toHaveBeenCalledWith('u-1');
  });

  it('leaves an admin only the link to Violations', async () => {
    renderMenu({ isOwner: false });

    await userEvent.click(screen.getByRole('button', { name: 'pages:users.rowActions' }));

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(
      screen.getByRole('menuitem', { name: 'pages:users.menuOpenViolations' })
    ).toHaveAttribute('href', '/violations?people=u-1');
  });

  it('offers no view-as for a disabled account', async () => {
    renderMenu({ row: { ...row, role: 'disabled' } });

    await userEvent.click(screen.getByRole('button', { name: 'pages:users.rowActions' }));

    expect(
      screen.queryByRole('menuitem', { name: 'pages:userDetail.access.viewAs' })
    ).not.toBeInTheDocument();
  });

  it('leaves out Adjust trust for a merged person, whose badge is the identity minimum', async () => {
    renderMenu({
      row: {
        ...row,
        identityServers: [
          { id: 'server-1', name: 'One' },
          { id: 'server-2', name: 'Two' },
        ],
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'pages:users.rowActions' }));

    expect(
      screen.getByRole('menuitem', { name: 'pages:userDetail.editIdentity' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'pages:userDetail.adjustTrustScore' })
    ).not.toBeInTheDocument();
  });
});
