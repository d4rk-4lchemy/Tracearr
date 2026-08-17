import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleV2, Session } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { EvaluationResult } from '../types.js';

const mockExecute = vi.fn();
const mockSelectLimit = vi.fn();
const mockInsertReturning = vi.fn();
const mockTransaction = vi.fn();
const mockRecompute = vi.fn();
const mockUpdate = vi.fn();

let capturedWhere: unknown;
let capturedLockSql: unknown;

function makeTx() {
  return {
    execute: (q: unknown) => {
      capturedLockSql = q;
      return mockExecute(q);
    },
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          capturedWhere = w;
          return { limit: mockSelectLimit };
        },
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: mockInsertReturning }) }),
    }),
    update: mockUpdate,
  };
}

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL);

vi.mock('../../../db/client.js', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));
vi.mock('../../../db/schema.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));
vi.mock('../../userService.js', () => ({
  recomputeIdentityAggregatesForServerUser: (...args: unknown[]) => mockRecompute(...args),
}));
import { buildViolationValues, recordViolation } from '../violationWriter.js';

const rule = {
  id: 'r1',
  name: 'Rule',
  severity: 'high',
  actions: { actions: [] },
} as unknown as RuleV2;
const result: EvaluationResult = {
  ruleId: 'r1',
  ruleName: 'Rule',
  matched: true,
  matchedGroups: [0],
  actions: [],
  evidence: [
    {
      groupIndex: 0,
      matched: true,
      conditions: [
        {
          field: 'concurrent_streams',
          operator: 'gte',
          threshold: 2,
          actual: 2,
          matched: true,
          relatedSessionIds: ['s2'],
        },
      ],
    },
  ],
};
const session = { id: 's1', sessionKey: 'sk', mediaTitle: 'M', ipAddress: '1.1.1.1' } as Session;
const inserted = { id: 'v1', ruleId: 'r1', serverUserId: 'su1', sessionId: 's1' };

describe('recordViolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedWhere = undefined;
    capturedLockSql = undefined;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx())
    );
    mockExecute.mockResolvedValue(undefined);
    mockSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([inserted]);
    mockRecompute.mockResolvedValue(undefined);
    mockUpdate.mockReset();
  });

  describe('session scope', () => {
    it('locks, gates, inserts, and recomputes aggregates in its own transaction', async () => {
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'session', sessionId: 's1' },
        session,
        marker: { transcodeReEval: true },
      });

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockSelectLimit).toHaveBeenCalledTimes(1);
      expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(
        mockSelectLimit.mock.invocationCallOrder[0] ?? Infinity
      );
      const lock = render(capturedLockSql);
      expect(lock.sql).toBe("SELECT pg_advisory_xact_lock(hashtext($1 || '::' || $2))");
      expect(lock.params).toEqual(['s1', 'r1']);
      const gate = render(capturedWhere);
      expect(gate.sql).toBe(
        '("violations"."rule_id" = $1 and "violations"."session_id" = $2 and ("violations"."acknowledged_at" is null or "violations"."dismissed_at" is not null))'
      );
      expect(gate.params).toEqual(['r1', 's1']);
      expect(mockRecompute).toHaveBeenCalledWith('su1', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(v).toEqual(inserted);
    });

    it('skips when the gate finds an open or dismissed row', async () => {
      mockSelectLimit.mockResolvedValue([{ id: 'existing' }]);
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'session', sessionId: 's1' },
        session,
      });
      expect(v).toBeNull();
      expect(mockInsertReturning).not.toHaveBeenCalled();
      expect(mockRecompute).not.toHaveBeenCalled();
    });

    it('returns null and skips aggregates when onConflictDoNothing inserts nothing', async () => {
      mockInsertReturning.mockResolvedValue([]);
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'session', sessionId: 's1' },
        session,
      });
      expect(v).toBeNull();
      expect(mockRecompute).not.toHaveBeenCalled();
    });

    it('with fresh: true skips the lock and the gate and uses the caller tx', async () => {
      const tx = makeTx();
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'session', sessionId: 's1', fresh: true },
        session,
        tx: tx as never,
      });
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockSelectLimit).not.toHaveBeenCalled();
      expect(mockInsertReturning).toHaveBeenCalledTimes(1);
      expect(mockRecompute).toHaveBeenCalledWith('su1', tx);
      expect(v).toEqual(inserted);
    });
  });

  describe('account scope', () => {
    it('locks on the server user, gates on any row, inserts with a null session', async () => {
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'account', serverUserId: 'su1' },
        session: null,
      });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockSelectLimit).toHaveBeenCalledTimes(1);
      const lock = render(capturedLockSql);
      expect(lock.params).toEqual(['su1', 'r1']);
      const gate = render(capturedWhere);
      expect(gate.sql).toBe('("violations"."rule_id" = $1 and "violations"."server_user_id" = $2)');
      expect(gate.params).toEqual(['r1', 'su1']);
      expect(v).toEqual(inserted);
    });

    it('skips when any row exists for the pair, acknowledged or dismissed included', async () => {
      mockSelectLimit.mockResolvedValue([{ id: 'existing' }]);
      const v = await recordViolation({
        result,
        rule,
        serverUserId: 'su1',
        scope: { kind: 'account', serverUserId: 'su1' },
        session: null,
      });
      expect(v).toBeNull();
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });
});

describe('buildViolationValues', () => {
  it('builds the same data payload the twins wrote, plus the marker', () => {
    const values = buildViolationValues({
      result,
      rule,
      serverUserId: 'su1',
      scope: { kind: 'session', sessionId: 's1' },
      session,
      marker: { pauseReEval: true },
    });
    expect(values).toEqual({
      ruleId: 'r1',
      serverUserId: 'su1',
      sessionId: 's1',
      severity: 'high',
      ruleType: null,
      data: {
        evidence: result.evidence,
        relatedSessionIds: ['s2'],
        ruleName: 'Rule',
        matchedGroups: [0],
        sessionKey: 'sk',
        mediaTitle: 'M',
        ipAddress: '1.1.1.1',
        pauseReEval: true,
      },
    });
  });

  it('omits session keys and uses a null sessionId for the account scope', () => {
    const values = buildViolationValues({
      result,
      rule,
      serverUserId: 'su1',
      scope: { kind: 'account', serverUserId: 'su1' },
      session: null,
    });
    expect(values.sessionId).toBeNull();
    expect(values.ruleType).toBeNull();
    expect(values.data).not.toHaveProperty('sessionKey');
    expect(values.data).not.toHaveProperty('mediaTitle');
    expect(values.data).not.toHaveProperty('ipAddress');
  });

  it('defaults severity to warning', () => {
    const values = buildViolationValues({
      result,
      rule: { ...rule, severity: undefined } as unknown as RuleV2,
      serverUserId: 'su1',
      scope: { kind: 'session', sessionId: 's1' },
      session,
    });
    expect(values.severity).toBe('warning');
  });
});
