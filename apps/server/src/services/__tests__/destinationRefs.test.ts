import { describe, expect, it, vi } from 'vitest';
import type { RuleActions } from '@tracearr/shared';

interface RuleRow {
  id: string;
  name: string;
  isActive: boolean;
  actions: RuleActions | null;
}

const ruleRows: RuleRow[] = [];
vi.mock('../../db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [...ruleRows],
      }),
    }),
  },
}));

import { rulesReferencingDestinations } from '../notifications/destinationRefs.js';

describe('rulesReferencingDestinations', () => {
  it('counts inactive rules and ignores non-send actions', async () => {
    ruleRows.length = 0;
    ruleRows.push(
      {
        id: 'rule-1',
        name: 'Active both',
        isActive: true,
        actions: { actions: [{ type: 'send', to: ['dest-a', 'dest-b'] }] },
      },
      {
        id: 'rule-2',
        name: 'Inactive A',
        isActive: false,
        actions: { actions: [{ type: 'send', to: ['dest-a'] }] },
      },
      {
        id: 'rule-3',
        name: 'Kill only',
        isActive: true,
        actions: { actions: [{ type: 'kill_stream' }] },
      }
    );

    const refs = await rulesReferencingDestinations();

    expect(refs.get('dest-a')).toEqual([
      { ruleId: 'rule-1', ruleName: 'Active both', isActive: true },
      { ruleId: 'rule-2', ruleName: 'Inactive A', isActive: false },
    ]);
    expect(refs.get('dest-b')).toEqual([
      { ruleId: 'rule-1', ruleName: 'Active both', isActive: true },
    ]);
    expect(refs.size).toBe(2);
  });
});
