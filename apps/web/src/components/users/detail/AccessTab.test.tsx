import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServerUserFullDetail } from '@tracearr/shared';
import { AccessTab } from './AccessTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/users/UserAccessControls', () => ({
  UserAccessControls: () => <p>access controls</p>,
}));
vi.mock('@/hooks/useServerColorMap', () => ({ useServerColorMap: () => new Map() }));

const account = {
  id: 'su-1',
  serverId: 'server-1',
  serverName: 'One',
  serverType: 'plex',
  username: 'alice',
  thumbUrl: null,
  trustScore: 90,
  sessionCount: 4,
  removedAt: null,
  mergedIn: false,
};

function detail(serverUsers: (typeof account)[]) {
  return {
    user: { id: 'su-1', username: 'alice', identityName: null, role: 'member' },
    identity: { serverUsers },
  } as unknown as ServerUserFullDetail;
}

describe('AccessTab', () => {
  it('shows linked accounts only for a merged person and splits only merged-in accounts', async () => {
    const onSplit = vi.fn();
    const { rerender } = render(
      <AccessTab
        detail={detail([account])}
        isOwner
        onAdjustTrust={vi.fn()}
        onSplit={onSplit}
        splitPending={false}
      />
    );
    expect(screen.getByText('access controls')).toBeInTheDocument();
    expect(screen.queryByText('pages:userDetail.linkedAccounts')).not.toBeInTheDocument();

    const second = {
      ...account,
      id: 'su-2',
      serverId: 'server-2',
      serverName: 'Two',
      mergedIn: true,
    };
    rerender(
      <AccessTab
        detail={detail([account, second])}
        isOwner
        onAdjustTrust={vi.fn()}
        onSplit={onSplit}
        splitPending={false}
      />
    );

    const splits = screen.getAllByRole('button', { name: 'pages:userDetail.splitAccount' });
    expect(splits).toHaveLength(1);
    await userEvent.click(splits[0] as HTMLElement);
    expect(onSplit).toHaveBeenCalledWith(second);
  });

  it('shows an admin the linked accounts without the controls or the owner buttons', () => {
    const second = {
      ...account,
      id: 'su-2',
      serverId: 'server-2',
      serverName: 'Two',
      mergedIn: true,
    };
    render(
      <AccessTab
        detail={detail([account, second])}
        isOwner={false}
        onAdjustTrust={vi.fn()}
        onSplit={vi.fn()}
        splitPending={false}
      />
    );

    expect(screen.queryByText('access controls')).not.toBeInTheDocument();
    expect(screen.getByText('pages:userDetail.linkedAccounts')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("hides the sign-in controls on the owner's own row but keeps the split", () => {
    const second = {
      ...account,
      id: 'su-2',
      serverId: 'server-2',
      serverName: 'Two',
      mergedIn: true,
    };
    const owned = detail([account, second]);
    render(
      <AccessTab
        detail={{ ...owned, user: { ...owned.user, role: 'owner' } }}
        isOwner
        onAdjustTrust={vi.fn()}
        onSplit={vi.fn()}
        splitPending={false}
      />
    );

    expect(screen.queryByText('access controls')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'pages:userDetail.splitAccount' })
    ).toBeInTheDocument();
  });
});
