import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignInCell } from './SignInCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));
vi.mock('@/hooks/queries', () => ({ useSettings: mockUseSettings }));

function memberSwitch(member: boolean | undefined) {
  mockUseSettings.mockReturnValue({
    data: member === undefined ? undefined : { loginMethods: { member } },
  });
}

describe('SignInCell', () => {
  beforeEach(() => memberSwitch(true));

  it('names the stored setting first and what it means in effect second', () => {
    render(
      <SignInCell
        row={{ role: 'member', loginAccess: 'allow', lastLoginAt: new Date().toISOString() }}
        isOwner
      />
    );

    expect(screen.getByText('pages:userDetail.access.signInAllow')).toBeInTheDocument();
    expect(screen.getByText('pages:users.signInOn')).toBeInTheDocument();
    expect(screen.getByText(/pages:users\.signedInAgo/)).toBeInTheDocument();
  });

  it('reads Default / On for the owner row whatever the member switch says', () => {
    memberSwitch(false);
    render(
      <SignInCell row={{ role: 'owner', loginAccess: 'default', lastLoginAt: null }} isOwner />
    );

    expect(screen.getByText('pages:userDetail.access.signInDefault')).toBeInTheDocument();
    expect(screen.getByText('pages:users.signInOn')).toBeInTheDocument();
    expect(screen.getByText(/pages:users\.neverSignedIn/)).toBeInTheDocument();
  });

  it('shows Off in effect for blocked, disabled and pending accounts', () => {
    const { rerender } = render(
      <SignInCell row={{ role: 'member', loginAccess: 'block', lastLoginAt: null }} isOwner />
    );
    expect(screen.getByText('pages:userDetail.access.signInBlock')).toBeInTheDocument();
    expect(screen.getByText('pages:users.signInOff')).toBeInTheDocument();

    rerender(
      <SignInCell row={{ role: 'pending', loginAccess: 'allow', lastLoginAt: null }} isOwner />
    );
    expect(screen.getByText('pages:userDetail.access.signInAllow')).toBeInTheDocument();
    expect(screen.getByText('pages:users.signInOff')).toBeInTheDocument();
  });

  it('resolves Default from the member switch, and only asks for settings as the owner', () => {
    memberSwitch(false);
    const { rerender } = render(
      <SignInCell row={{ role: 'member', loginAccess: 'default', lastLoginAt: null }} isOwner />
    );
    expect(mockUseSettings).toHaveBeenLastCalledWith({ enabled: true });
    expect(screen.getByText('pages:users.signInOff')).toBeInTheDocument();

    memberSwitch(undefined);
    rerender(
      <SignInCell
        row={{ role: 'member', loginAccess: 'default', lastLoginAt: null }}
        isOwner={false}
      />
    );
    expect(mockUseSettings).toHaveBeenLastCalledWith({ enabled: false });
    expect(screen.queryByText(/pages:users\.signIn(On|Off)/)).not.toBeInTheDocument();
  });
});
