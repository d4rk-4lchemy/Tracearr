import type { Condition, ConditionGroup, RuleV2 } from '@tracearr/shared';
import { compare } from '../comparisons.js';
import { hasPauseConditions, PAUSE_CONDITION_FIELDS } from '../engine.js';

/** Fires after the boundary, never on it: gt N is false at exactly N (evaluators.test.ts, "supports gt operator for strict comparison"). */
export const CROSSING_PAD_MS = 1000;
/** Today's reconciliation-poll cadence; used only while a compound pause rule is held open. */
export const HOLD_OPEN_RECHECK_MS = 30_000;

const RISING_OPERATORS = new Set(['gt', 'gte']);

export interface PauseCrossingInput {
  lastPausedAt: number;
  pausedDurationMs: number;
  now: number;
  rules: RuleV2[];
}

export interface PauseCrossingResult {
  /** Earliest instant strictly after now to evaluate at, or null when nothing is left to wait for. */
  next: number | null;
  /** Earliest crossing at all, past or future; rehydrate uses it to evaluate immediately. */
  earliest: number | null;
  /** A satisfied pause condition shares a rule with a non-pause condition; keep rechecking. */
  holdOpen: boolean;
}

function crossingOf(c: Condition, input: PauseCrossingInput): number | null {
  if (!PAUSE_CONDITION_FIELDS.has(c.field) || !RISING_OPERATORS.has(c.operator)) return null;
  if (typeof c.value !== 'number') return null;
  const thresholdMs = c.value * 60_000;
  const at =
    c.field === 'current_pause_minutes'
      ? input.lastPausedAt + thresholdMs
      : input.lastPausedAt + thresholdMs - input.pausedDurationMs;
  return at + CROSSING_PAD_MS;
}

function satisfiedNow(c: Condition, input: PauseCrossingInput): boolean {
  if (!PAUSE_CONDITION_FIELDS.has(c.field)) return false;
  const currentMs = input.now - input.lastPausedAt;
  const minutes =
    c.field === 'current_pause_minutes'
      ? currentMs / 60_000
      : (input.pausedDurationMs + currentMs) / 60_000;
  return compare(minutes, c.operator, c.value);
}

/** Groups are AND'd, conditions in a group OR'd: a companion can only flip the rule while every group not already met by a pause condition has one. */
function holdsOpen(groups: ConditionGroup[], input: PauseCrossingInput): boolean {
  const unmet = groups.filter((g) => !g.conditions.some((c) => satisfiedNow(c, input)));
  return (
    unmet.length > 0 &&
    unmet.length < groups.length &&
    unmet.every((g) => g.conditions.some((c) => !PAUSE_CONDITION_FIELDS.has(c.field)))
  );
}

export function pauseCrossings(input: PauseCrossingInput): PauseCrossingResult {
  let next: number | null = null;
  let earliest: number | null = null;
  let holdOpen = false;

  for (const rule of input.rules) {
    if (!rule.isActive || !hasPauseConditions(rule)) continue;
    const groups = rule.conditions.groups;
    for (const c of groups.flatMap((g) => g.conditions)) {
      const at = crossingOf(c, input);
      if (at === null) continue;
      if (earliest === null || at < earliest) earliest = at;
      if (at > input.now && (next === null || at < next)) next = at;
    }
    if (holdsOpen(groups, input)) holdOpen = true;
  }

  if (holdOpen) {
    const recheck = input.now + HOLD_OPEN_RECHECK_MS;
    next = next === null ? recheck : Math.min(next, recheck);
  }
  return { next, earliest, holdOpen };
}
