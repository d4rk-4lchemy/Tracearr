import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleV2 } from '@tracearr/shared';

const mockGetActiveRulesV2 = vi.fn();
const mockBatchIdentity = vi.fn();
vi.mock('../poller/database.js', () => ({
  getActiveRulesV2: (...a: unknown[]) => mockGetActiveRulesV2(...a),
  batchGetIdentityServerUserIds: (...a: unknown[]) => mockBatchIdentity(...a),
}));
const mockWhere = vi.fn();
vi.mock('../../db/client.js', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (...a: unknown[]) => mockWhere(...a),
      };
      return chain;
    },
  },
}));
vi.mock('../../db/schema.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));
const mockDispatch = vi.fn();
vi.mock('../../services/rules/events/dispatcher.js', () => ({
  dispatch: (...a: unknown[]) => mockDispatch(...a),
}));
const mockBroadcast = vi.fn();
vi.mock('../poller/violations.js', () => ({
  broadcastViolations: (...a: unknown[]) => mockBroadcast(...a),
}));
vi.mock('../queueConnection.js', () => ({
  getBullPrefix: () => 'bull',
  queueConnectionOptions: () => ({}),
}));
vi.mock('bullmq', () => {
  class QueueMock {
    on(): this {
      return this;
    }
  }
  return { Queue: QueueMock, Worker: QueueMock };
});

import {
  initInactivityCheckQueue,
  processInactivityCheckForTests,
} from '../inactivityCheckQueue.js';

function inactivityRule(id: string, scope: Partial<RuleV2> = {}): RuleV2 {
  return {
    id,
    name: id,
    isActive: true,
    severity: 'warning',
    conditions: {
      groups: [{ conditions: [{ field: 'inactive_days', operator: 'gte', value: 30 }] }],
    },
    actions: { actions: [] },
    serverId: null,
    serverUserId: null,
    userId: null,
    ...scope,
  } as unknown as RuleV2;
}
const candidate = (id: string, userId = 'u1') => ({
  id,
  userId,
  username: id,
  thumbUrl: null,
  identityName: null,
  lastActivityAt: null,
  trustScore: 100,
  createdAt: new Date(),
  serverId: 'srv1',
  serverName: 'S',
  serverType: 'plex',
});
const job = { id: 'j1', data: { type: 'check' } } as never;

describe('processInactivityCheck', () => {
  const publish = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    initInactivityCheckQueue('redis://x', {} as never, publish);
    mockBatchIdentity.mockResolvedValue(
      new Map([
        ['u1', ['su1']],
        ['u2', ['su2']],
      ])
    );
    mockDispatch.mockResolvedValue({ violations: [], outcomes: [] });
  });

  it('dispatches account.inactive_for once per distinct candidate across rule scopes', async () => {
    mockGetActiveRulesV2.mockResolvedValue([
      inactivityRule('a'),
      inactivityRule('b', { serverId: 'srv1' }),
    ]);
    mockWhere
      .mockResolvedValueOnce([candidate('su1'), candidate('su2', 'u2')])
      .mockResolvedValueOnce([candidate('su1')]);
    await processInactivityCheckForTests(job);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    for (const call of mockDispatch.mock.calls) {
      expect(call[0]).toMatchObject({ type: 'account.inactive_for', session: null });
      expect(call[1]).toMatchObject({ activeSessions: [], recentSessions: [] });
      expect((call[1] as { activeRulesV2: RuleV2[] }).activeRulesV2.map((r) => r.id)).toEqual([
        'a',
        'b',
      ]);
    }
  });

  it('broadcasts returned violations keyed by the server user', async () => {
    mockGetActiveRulesV2.mockResolvedValue([inactivityRule('a')]);
    mockWhere.mockResolvedValueOnce([candidate('su1')]);
    mockDispatch.mockResolvedValue({
      violations: [{ violation: { id: 'v1' }, rule: { id: 'a', name: 'a', type: null } }],
      outcomes: [],
    });
    await processInactivityCheckForTests(job);
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.any(Array),
      { serverUserId: 'su1' },
      { publish }
    );
  });

  it('does nothing when no active rule has an inactive_days condition', async () => {
    mockGetActiveRulesV2.mockResolvedValue([
      {
        ...inactivityRule('x'),
        conditions: {
          groups: [{ conditions: [{ field: 'trust_score', operator: 'lt', value: 50 }] }],
        },
      } as RuleV2,
    ]);
    await processInactivityCheckForTests(job);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('honours a job scoped to one rule', async () => {
    mockGetActiveRulesV2.mockResolvedValue([inactivityRule('a'), inactivityRule('b')]);
    mockWhere.mockResolvedValueOnce([candidate('su1')]);
    await processInactivityCheckForTests({
      id: 'j2',
      data: { type: 'check', ruleId: 'b' },
    } as never);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(
      (mockDispatch.mock.calls[0]?.[1] as { activeRulesV2: RuleV2[] }).activeRulesV2.map(
        (r) => r.id
      )
    ).toEqual(['b']);
  });

  it('a failing dispatch for one candidate does not stop the others', async () => {
    mockGetActiveRulesV2.mockResolvedValue([inactivityRule('a')]);
    mockWhere.mockResolvedValueOnce([candidate('su1'), candidate('su2', 'u2')]);
    mockDispatch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ violations: [], outcomes: [] });
    await processInactivityCheckForTests(job);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });
});
