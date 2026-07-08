import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionsToolbar, type BulkAction } from './bulk-actions-toolbar';

function renderToolbar(actions: BulkAction[]) {
  return render(
    <BulkActionsToolbar selectedCount={2} actions={actions} onClearSelection={vi.fn()} />
  );
}

describe('BulkActionsToolbar', () => {
  it('shows the tooltip reason for a disabled action on hover', async () => {
    const user = userEvent.setup();
    const action: BulkAction = {
      key: 'merge',
      label: 'Merge users',
      disabled: true,
      title: 'Select exactly two users to merge',
      onClick: vi.fn(),
    };

    renderToolbar([action]);

    const button = screen.getByRole('button', { name: 'Merge users' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('title');

    await user.hover(button);

    expect(await screen.findAllByText('Select exactly two users to merge')).not.toHaveLength(0);
  });

  it('does not render a tooltip trigger wrapper when an action has no title', () => {
    const action: BulkAction = {
      key: 'reset',
      label: 'Reset trust score',
      onClick: vi.fn(),
    };

    renderToolbar([action]);

    expect(screen.getByRole('button', { name: 'Reset trust score' })).toBeEnabled();
  });
});
