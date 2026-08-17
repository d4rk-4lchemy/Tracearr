import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Destination } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RuleBuilder } from '../RuleBuilder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ servers: [] }),
}));

vi.mock('@/hooks/queries/useUsers', () => ({
  useUsers: () => ({ data: undefined }),
}));

vi.mock('@/hooks/queries', () => ({
  useSettings: () => ({ data: undefined }),
}));

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: vi.fn(),
  useCreateDestination: vi.fn(),
  useUpdateDestination: vi.fn(),
  useTestDestination: vi.fn(),
  useTestUnsavedDestination: vi.fn(),
}));

import { useDestinations } from '@/hooks/queries/useDestinations';

const discord: Destination = {
  id: 'dest-discord',
  name: 'Team Discord',
  type: 'discord',
  enabled: true,
  builtin: false,
  events: ['violation_detected'],
  configStatus: 'ok',
  config: { webhookUrl: null },
  secretsSet: ['webhookUrl'],
  referencedByRuleCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const onSave = vi.fn();
const onCancel = vi.fn();

function renderBuilder(to: string[]) {
  return render(
    <TooltipProvider>
      <RuleBuilder
        initialRule={{
          id: 'rule-1',
          name: 'Too many streams',
          isActive: true,
          conditions: {
            groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 3 }] }],
          },
          actions: { actions: [{ type: 'send', to }] },
        }}
        onSave={onSave}
        onCancel={onCancel}
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  onSave.mockReset();
  onCancel.mockReset();
  vi.mocked(useDestinations).mockReturnValue({
    data: [discord],
    isLoading: false,
  } as unknown as ReturnType<typeof useDestinations>);
});

describe('RuleBuilder validation', () => {
  it('blocks save when a send action has no destination', async () => {
    const user = userEvent.setup();
    renderBuilder([]);

    await user.click(screen.getByRole('button', { name: /Update Rule/ }));

    expect(screen.getByText('rules.builder.errors.sendNeedsDestination')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves once a destination is picked', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord']);

    await user.click(screen.getByRole('button', { name: /Update Rule/ }));

    expect(screen.queryByText('rules.builder.errors.sendNeedsDestination')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
