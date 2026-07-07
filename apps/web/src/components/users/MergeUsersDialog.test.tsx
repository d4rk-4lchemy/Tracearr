import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MergeUsersDialog, type MergeCandidate } from './MergeUsersDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const candidates: [MergeCandidate, MergeCandidate] = [
  { userId: 'user-a', displayName: 'Bob (Plex)', username: 'bob', loginCapable: false },
  { userId: 'user-b', displayName: 'Bob (Jellyfin)', username: 'bob-jf', loginCapable: false },
];

function renderDialog(overrides: Partial<Parameters<typeof MergeUsersDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <MergeUsersDialog
      open
      onOpenChange={vi.fn()}
      candidates={candidates}
      requiredTargetUserId={null}
      sameServerWarning={false}
      sameServerName={null}
      onConfirm={onConfirm}
      isLoading={false}
      {...overrides}
    />
  );
  return { onConfirm };
}

describe('MergeUsersDialog', () => {
  it('lets the admin pick the primary between two plain identities', async () => {
    const { onConfirm } = renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /Bob \(Jellyfin\)/ }));
    await userEvent.click(screen.getByRole('button', { name: 'pages:users.mergeConfirm' }));

    expect(onConfirm).toHaveBeenCalledWith({
      sourceUserId: 'user-a',
      targetUserId: 'user-b',
      confirmSameServerCombine: false,
    });
  });

  it('forces a login-capable identity as the target', () => {
    renderDialog({
      candidates: [{ ...candidates[0], loginCapable: true }, candidates[1]],
      requiredTargetUserId: 'user-a',
    });

    expect(screen.getByRole('radio', { name: /Bob \(Plex\)/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Bob \(Jellyfin\)/ })).toBeDisabled();
    expect(screen.getByText('pages:users.mergePrimaryForced')).toBeInTheDocument();
  });

  it('does not show the destructive confirmation button when there is no same-server conflict', () => {
    renderDialog();

    expect(screen.queryByText('pages:users.mergeSameServerWarning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pages:users.mergeConfirm' })).toBeEnabled();
  });

  it('requires a distinct alert-dialog acknowledgement before a same-server combine, naming the server', async () => {
    const { onConfirm } = renderDialog({
      sameServerWarning: true,
      sameServerName: 'Living Room Plex',
    });

    // The destructive confirmation is loud, explicit, and names the affected server.
    expect(screen.getByText('pages:users.mergeSameServerWarningTitle')).toBeInTheDocument();
    expect(screen.getByText('pages:users.mergeSameServerWarning')).toBeInTheDocument();
    expect(screen.getByText('Living Room Plex')).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'pages:users.mergeConfirm' });
    expect(confirmButton).toBeDisabled();

    const acknowledgeCheckbox = screen.getByRole('checkbox', {
      name: 'pages:users.mergeSameServerAcknowledge',
    });
    expect(acknowledgeCheckbox).not.toBeChecked();

    await userEvent.click(acknowledgeCheckbox);
    expect(confirmButton).toBeEnabled();

    await userEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith({
      sourceUserId: 'user-b',
      targetUserId: 'user-a',
      confirmSameServerCombine: true,
    });
  });

  it('labels a removed server account as historical with a muted badge', () => {
    renderDialog({
      candidates: [
        {
          ...candidates[0],
          serverUsers: [
            { id: 'su-1', serverName: 'Living Room Plex', removedAt: '2026-01-01T00:00:00.000Z' },
          ],
        },
        candidates[1],
      ],
    });

    expect(screen.getByText('pages:users.mergeServerAccountRemoved')).toBeInTheDocument();
  });
});
