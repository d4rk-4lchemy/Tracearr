import { describe, expect, it } from 'vitest';
import type { RuleV2 } from '@tracearr/shared';
import { CROSSING_PAD_MS, HOLD_OPEN_RECHECK_MS, pauseCrossings } from '../wakes/crossings.js';

const MIN = 60_000;
const t0 = Date.UTC(2026, 7, 16, 12, 0, 0);

interface Cond {
  field: string;
  operator: string;
  value: number;
}

function groups(id: string, ...groupConds: Cond[][]): RuleV2 {
  return {
    id,
    name: id,
    isActive: true,
    severity: 'warning',
    conditions: { groups: groupConds.map((conditions) => ({ conditions })) },
    actions: { actions: [] },
  } as unknown as RuleV2;
}
function rule(id: string, conds: Cond[]): RuleV2 {
  return groups(id, conds);
}
function twoGroups(id: string, a: Cond, b: Cond): RuleV2 {
  return groups(id, [a], [b]);
}

describe('pauseCrossings', () => {
  it('current_pause_minutes gt/gte cross at lastPausedAt + N minutes, plus the pad', () => {
    const rules = [rule('a', [{ field: 'current_pause_minutes', operator: 'gt', value: 10 }])];
    const r = pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0 + 1000, rules });
    expect(r.next).toBe(t0 + 10 * MIN + CROSSING_PAD_MS);
    expect(r.earliest).toBe(t0 + 10 * MIN + CROSSING_PAD_MS);
    expect(r.holdOpen).toBe(false);
  });

  it('total_pause_minutes accounts for already accumulated pause time', () => {
    const rules = [rule('a', [{ field: 'total_pause_minutes', operator: 'gte', value: 30 }])];
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 20 * MIN,
      now: t0 + 1000,
      rules,
    });
    expect(r.next).toBe(t0 + 10 * MIN + CROSSING_PAD_MS);
  });

  it('a total_pause_minutes threshold already exceeded by accumulated time is a past crossing', () => {
    const rules = [rule('t', [{ field: 'total_pause_minutes', operator: 'gte', value: 30 }])];
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 40 * MIN,
      now: t0 + 1000,
      rules,
    });
    expect(r.next).toBeNull();
    expect(r.earliest).toBe(t0 + 30 * MIN - 40 * MIN + CROSSING_PAD_MS);
  });

  it('picks the earliest future crossing across rules and conditions', () => {
    const rules = [
      rule('a', [{ field: 'current_pause_minutes', operator: 'gt', value: 30 }]),
      rule('b', [{ field: 'current_pause_minutes', operator: 'gte', value: 5 }]),
    ];
    const r = pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0 + 1000, rules });
    expect(r.next).toBe(t0 + 5 * MIN + CROSSING_PAD_MS);
  });

  it('drops crossings at or before now from next but keeps them in earliest', () => {
    const rules = [
      rule('a', [{ field: 'current_pause_minutes', operator: 'gt', value: 5 }]),
      rule('b', [{ field: 'current_pause_minutes', operator: 'gt', value: 60 }]),
    ];
    const r = pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0 + 20 * MIN, rules });
    expect(r.next).toBe(t0 + 60 * MIN + CROSSING_PAD_MS);
    expect(r.earliest).toBe(t0 + 5 * MIN + CROSSING_PAD_MS);
  });

  it('eq, lt, lte, neq contribute nothing', () => {
    const rules = [
      rule('a', [{ field: 'current_pause_minutes', operator: 'eq', value: 5 }]),
      rule('b', [{ field: 'current_pause_minutes', operator: 'lt', value: 5 }]),
      rule('c', [{ field: 'total_pause_minutes', operator: 'lte', value: 5 }]),
      rule('d', [{ field: 'total_pause_minutes', operator: 'neq', value: 5 }]),
    ];
    const r = pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0, rules });
    expect(r).toEqual({ next: null, earliest: null, holdOpen: false });
  });

  it('ignores rules without pause conditions and inactive rules', () => {
    const rules = [
      rule('a', [{ field: 'concurrent_streams', operator: 'gt', value: 2 }]),
      {
        ...rule('b', [{ field: 'current_pause_minutes', operator: 'gt', value: 5 }]),
        isActive: false,
      } as RuleV2,
    ];
    const r = pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0, rules });
    expect(r.next).toBeNull();
  });

  it('holdOpen is true only when a satisfied pause condition shares a rule with a non-pause condition', () => {
    const compound = twoGroups(
      'c',
      { field: 'current_pause_minutes', operator: 'gte', value: 10 },
      { field: 'concurrent_streams', operator: 'gte', value: 3 }
    );
    const pure = rule('p', [{ field: 'current_pause_minutes', operator: 'gte', value: 10 }]);

    expect(
      pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0 + MIN, rules: [compound] })
        .holdOpen
    ).toBe(false);
    const after = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 0,
      now: t0 + 15 * MIN,
      rules: [compound],
    });
    expect(after.holdOpen).toBe(true);
    expect(after.next).toBe(t0 + 15 * MIN + HOLD_OPEN_RECHECK_MS);
    expect(
      pauseCrossings({ lastPausedAt: t0, pausedDurationMs: 0, now: t0 + 15 * MIN, rules: [pure] })
    ).toEqual({
      next: null,
      earliest: t0 + 10 * MIN + CROSSING_PAD_MS,
      holdOpen: false,
    });
  });

  it('a single group mixing a pause and a non-pause condition does not hold open', () => {
    const mixed = rule('o', [
      { field: 'current_pause_minutes', operator: 'gte', value: 10 },
      { field: 'concurrent_streams', operator: 'gte', value: 3 },
    ]);
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 0,
      now: t0 + 15 * MIN,
      rules: [mixed],
    });
    expect(r).toEqual({
      next: null,
      earliest: t0 + 10 * MIN + CROSSING_PAD_MS,
      holdOpen: false,
    });
  });

  it('an unmet mixed group alongside a met pause group holds open', () => {
    const mixed = groups(
      'm',
      [{ field: 'current_pause_minutes', operator: 'gte', value: 10 }],
      [
        { field: 'current_pause_minutes', operator: 'gte', value: 60 },
        { field: 'concurrent_streams', operator: 'gte', value: 3 },
      ]
    );
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 0,
      now: t0 + 15 * MIN,
      rules: [mixed],
    });
    expect(r.holdOpen).toBe(true);
    expect(r.next).toBe(t0 + 15 * MIN + HOLD_OPEN_RECHECK_MS);
  });

  it('holdOpen recheck does not push out an earlier real crossing', () => {
    const compound = twoGroups(
      'c',
      { field: 'current_pause_minutes', operator: 'gte', value: 1 },
      { field: 'concurrent_streams', operator: 'gte', value: 3 }
    );
    const later = rule('l', [{ field: 'current_pause_minutes', operator: 'gte', value: 2 }]);
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 0,
      now: t0 + 100_000,
      rules: [compound, later],
    });
    expect(r.holdOpen).toBe(true);
    expect(r.next).toBe(t0 + 2 * MIN + CROSSING_PAD_MS);
  });

  it('holdOpen recheck comes first when it is nearer', () => {
    const compound = twoGroups(
      'c',
      { field: 'current_pause_minutes', operator: 'gte', value: 1 },
      { field: 'concurrent_streams', operator: 'gte', value: 3 }
    );
    const later = rule('l', [{ field: 'current_pause_minutes', operator: 'gte', value: 2 }]);
    const r = pauseCrossings({
      lastPausedAt: t0,
      pausedDurationMs: 0,
      now: t0 + 90_000,
      rules: [compound, later],
    });
    expect(r.holdOpen).toBe(true);
    expect(r.next).toBe(t0 + 90_000 + HOLD_OPEN_RECHECK_MS);
  });
});
