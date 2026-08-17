/**
 * V2 Integration Tests - Rule notification dependency
 *
 * The send executor already built the event; this dep only resolves the
 * destination ids and reports how many jobs landed, so a rule whose
 * destinations are all disabled can be logged as such.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { rulesLogger } from '../../../utils/logger.js';
import type { NotificationEvent } from '../../notifications/events.js';

const { mockEnqueueNotification } = vi.hoisted(() => ({
  mockEnqueueNotification: vi.fn().mockResolvedValue(2),
}));

vi.mock('../../../jobs/notificationQueue.js', () => ({
  enqueueNotification: mockEnqueueNotification,
}));

vi.mock('../../../db/client.js', () => ({ db: {} }));

vi.mock('../../../jobs/poller/database.js', () => ({
  invalidateRulesCache: vi.fn(),
}));

vi.mock('../../userService.js', () => ({
  recomputeIdentityAggregates: vi.fn(),
}));

import { createActionExecutorDeps } from '../v2Integration.js';

const event: NotificationEvent = {
  type: 'violation',
  payload: {
    id: 'v1',
    ruleId: 'rule-1',
    serverUserId: 'su-1',
    sessionId: 'sess-1',
    severity: 'warning',
    createdAt: new Date('2026-08-17T00:00:00.000Z'),
    acknowledgedAt: null,
    data: { ruleId: 'rule-1', serverUserId: 'su-1' },
    rule: { id: 'rule-1', name: 'Sharing', type: null },
    session: undefined,
    user: {
      id: 'su-1',
      username: 'alice',
      identityName: 'Alice',
      thumbUrl: null,
      serverId: 'srv-1',
    },
  },
};

describe('createActionExecutorDeps - enqueueRuleNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hands the event straight to the queue with the destination ids and the rule source', async () => {
    const deps = createActionExecutorDeps({} as unknown as Redis);

    const count = await deps.enqueueRuleNotification({
      to: ['d1', 'd2'],
      title: 'Rule Triggered: Sharing',
      message: 'User "alice" triggered rule "Sharing"',
      event,
    });

    expect(count).toBe(2);
    expect(mockEnqueueNotification).toHaveBeenCalledWith(event, {
      to: ['d1', 'd2'],
      source: {
        kind: 'rule',
        title: 'Rule Triggered: Sharing',
        message: 'User "alice" triggered rule "Sharing"',
      },
    });
  });

  it('returns the queue count when nothing was enqueued and does not log an enqueue', async () => {
    mockEnqueueNotification.mockResolvedValueOnce(0);
    const info = vi.spyOn(rulesLogger, 'info');
    const deps = createActionExecutorDeps({} as unknown as Redis);

    const count = await deps.enqueueRuleNotification({
      to: ['d1'],
      title: 'Rule Triggered: Orphan',
      message: 'no destination',
      event,
    });

    expect(count).toBe(0);
    expect(info).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Notification enqueued/),
      expect.anything()
    );
  });
});
