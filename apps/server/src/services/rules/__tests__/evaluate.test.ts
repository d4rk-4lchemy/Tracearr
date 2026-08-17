import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleV2, Session } from '@tracearr/shared';
import type {
  AccountInactiveForEvent,
  EvaluationInputs,
  SessionPausedEvent,
  SessionTranscodeChangedEvent,
} from '../events/types.js';

const mockEvaluateRulesAsync = vi.fn();
vi.mock('../engine.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  evaluateRulesAsync: (...args: unknown[]) => mockEvaluateRulesAsync(...args),
}));
vi.mock('../../../utils/logger.js', () => ({
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { evaluateTrigger, rulesForTrigger } from '../events/evaluate.js';

function rule(id: string, field: string): RuleV2 {
  return {
    id,
    name: id,
    isActive: true,
    severity: 'warning',
    conditions: { groups: [{ conditions: [{ field, operator: 'gte', value: 1 }] }] },
    actions: { actions: [] },
  } as unknown as RuleV2;
}

const transcodeRule = rule('t', 'is_transcoding');
const pauseRule = rule('p', 'current_pause_minutes');
const concurrentRule = rule('c', 'concurrent_streams');
const inactivityRule = rule('i', 'inactive_days');
const all = [transcodeRule, pauseRule, concurrentRule, inactivityRule];

const server = { id: 'srv1', name: 'S', type: 'plex' as const };
const serverUser = {
  id: 'su1',
  userId: 'u1',
  username: 'x',
  thumbUrl: null,
  identityName: null,
  trustScore: 100,
  lastActivityAt: null,
  createdAt: new Date(),
  identityServerUserIds: ['su1'],
};
const session = { id: 's1', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;

describe('rulesForTrigger', () => {
  it('session.started evaluates every rule except inactivity rules', () => {
    expect(rulesForTrigger('session.started', all).map((r) => r.id)).toEqual(['t', 'p', 'c']);
  });
  it('account.inactive_for evaluates only inactivity rules', () => {
    expect(rulesForTrigger('account.inactive_for', all).map((r) => r.id)).toEqual(['i']);
  });
  it('transcode_changed evaluates only transcode rules', () => {
    expect(rulesForTrigger('session.transcode_changed', all).map((r) => r.id)).toEqual(['t']);
  });
  it('paused and held_for evaluate only pause rules', () => {
    expect(rulesForTrigger('session.paused', all).map((r) => r.id)).toEqual(['p']);
    expect(rulesForTrigger('session.held_for', all).map((r) => r.id)).toEqual(['p']);
  });
  it('cancel-only triggers evaluate nothing', () => {
    expect(rulesForTrigger('session.stopped', all)).toEqual([]);
  });
});

describe('evaluateTrigger', () => {
  beforeEach(() => {
    mockEvaluateRulesAsync.mockReset();
    mockEvaluateRulesAsync.mockResolvedValue([]);
  });

  it('builds the context around the event session and appends it to activeSessions by reference', async () => {
    const other = { id: 's2', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;
    const inputs: EvaluationInputs = {
      activeRulesV2: all,
      activeSessions: [other],
      recentSessions: [],
      identityServerUserIds: ['su1', 'su2'],
    };
    const event: SessionTranscodeChangedEvent = {
      type: 'session.transcode_changed',
      at: new Date(),
      server,
      serverUser,
      session,
      previous: { videoDecision: 'directplay', audioDecision: 'directplay' },
      next: { videoDecision: 'transcode', audioDecision: 'copy' },
    };

    const { rules, baseContext } = await evaluateTrigger(event, inputs);

    expect(rules.map((r) => r.id)).toEqual(['t']);
    expect(baseContext.session).toBe(session);
    expect(baseContext.activeSessions).toHaveLength(2);
    expect(baseContext.activeSessions[1]).toBe(session);
    expect(baseContext.identityServerUserIds).toEqual(['su1', 'su2']);
    expect(baseContext.server).toMatchObject({ id: 'srv1', type: 'plex' });
    expect(baseContext.serverUser).toMatchObject({ id: 'su1', userId: 'u1' });
    expect(mockEvaluateRulesAsync).toHaveBeenCalledWith(baseContext, [transcodeRule]);
  });

  it('does not double-append when the session is already in activeSessions', async () => {
    const inputs: EvaluationInputs = {
      activeRulesV2: all,
      activeSessions: [session],
      recentSessions: [],
    };
    const event: SessionPausedEvent = {
      type: 'session.paused',
      at: new Date(),
      server,
      serverUser,
      session,
      pauseData: { lastPausedAt: new Date(), pausedDurationMs: 0 },
    };
    const { baseContext } = await evaluateTrigger(event, inputs);
    expect(baseContext.activeSessions).toHaveLength(1);
  });

  it('builds a session-less context for account.inactive_for and leaves activeSessions alone', async () => {
    const other = { id: 's2', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;
    const inputs: EvaluationInputs = {
      activeRulesV2: all,
      activeSessions: [other],
      recentSessions: [],
    };
    const event: AccountInactiveForEvent = {
      type: 'account.inactive_for',
      at: new Date(),
      server,
      serverUser,
      session: null,
    };

    const { rules, baseContext } = await evaluateTrigger(event, inputs);

    expect(rules.map((r) => r.id)).toEqual(['i']);
    expect(baseContext.session).toBeNull();
    expect(baseContext.activeSessions).toBe(inputs.activeSessions);
    expect(mockEvaluateRulesAsync).toHaveBeenCalledWith(baseContext, [inactivityRule]);
  });

  it('returns early with no evaluation when no rule matches the trigger', async () => {
    const inputs: EvaluationInputs = {
      activeRulesV2: [concurrentRule],
      activeSessions: [],
      recentSessions: [],
    };
    const event: SessionPausedEvent = {
      type: 'session.paused',
      at: new Date(),
      server,
      serverUser,
      session,
      pauseData: { lastPausedAt: new Date(), pausedDurationMs: 0 },
    };
    const { rules, results } = await evaluateTrigger(event, inputs);
    expect(rules).toEqual([]);
    expect(results).toEqual([]);
    expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
  });
});
