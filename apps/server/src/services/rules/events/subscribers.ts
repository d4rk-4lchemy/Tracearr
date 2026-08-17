import { executeActions, type ActionResult } from '../executors/index.js';
import { storeActionResults } from '../v2Integration.js';
import { recordViolation, type ViolationScope } from '../violationWriter.js';
import { subscribe } from './dispatcher.js';
import { evaluateTrigger, type EvaluatingEvent, type SessionEvaluatingEvent } from './evaluate.js';
import type { RuleV2 } from '@tracearr/shared';
import type { EvaluationContext, EvaluationResult } from '../types.js';
import type { DispatchOptions, EvaluationInputs, SubscriberResult } from './types.js';
import type { ViolationInsertResult } from '../../../jobs/poller/violations.js';

interface PendingAct {
  context: EvaluationContext;
  result: EvaluationResult;
  rule: RuleV2;
  violationId: string;
}

async function runActs(pending: PendingAct[]): Promise<ActionResult[]> {
  const all: ActionResult[] = [];
  for (const { context, result, rule, violationId } of pending) {
    const results = await executeActions(context, result.actions);
    await storeActionResults(violationId, rule.id, results);
    all.push(...results);
  }
  return all;
}

/**
 * evaluate → record → act, per rule in that order. Actions run only for a
 * newly inserted violation; a deduped match runs none. Under deferActions the
 * act step is returned as a closure for the caller to run after its commit.
 */
export async function runRulePipeline(
  event: EvaluatingEvent,
  inputs: EvaluationInputs,
  opts: DispatchOptions,
  scope: ViolationScope,
  marker?: Record<string, true>
): Promise<SubscriberResult> {
  const { rules, baseContext, results } = await evaluateTrigger(event, inputs);
  const violations: ViolationInsertResult[] = [];
  const pending: PendingAct[] = [];

  for (const result of results) {
    if (!result.matched) continue;
    const rule = rules.find((r) => r.id === result.ruleId);
    if (!rule) continue;

    const violation = await recordViolation({
      result,
      rule,
      serverUserId: event.serverUser.id,
      scope,
      session: event.session,
      marker,
      tx: opts.tx,
    });
    if (!violation) continue;

    violations.push({ violation, rule: { id: rule.id, name: rule.name, type: null } });
    if (result.actions.length === 0) continue;

    const act: PendingAct = {
      context: { ...baseContext, rule, violationId: violation.id },
      result,
      rule,
      violationId: violation.id,
    };
    if (opts.deferActions) pending.push(act);
    else await runActs([act]);
  }

  if (opts.deferActions && pending.length > 0) {
    return { violations, deferredActions: () => runActs(pending) };
  }
  return { violations };
}

function sessionRules(marker?: Record<string, true>, fresh?: boolean) {
  return async (
    event: SessionEvaluatingEvent,
    inputs: EvaluationInputs | undefined,
    opts: DispatchOptions
  ) => {
    if (!inputs) return;
    return runRulePipeline(
      event,
      inputs,
      opts,
      { kind: 'session', sessionId: event.session.id, ...(fresh ? { fresh } : {}) },
      marker
    );
  };
}

let registered = false;

export function registerRuleSubscribers(): void {
  if (registered) return;
  registered = true;

  subscribe('session.started', 'session-rules', sessionRules(undefined, true));
  subscribe('session.transcode_changed', 'session-rules', sessionRules({ transcodeReEval: true }));
  subscribe('session.paused', 'session-rules', sessionRules({ pauseReEval: true }));
  subscribe('session.held_for', 'session-rules', sessionRules({ heldFor: true }));
  subscribe('account.inactive_for', 'account-rules', async (event, inputs, opts) => {
    if (!inputs) return;
    return runRulePipeline(event, inputs, opts, {
      kind: 'account',
      serverUserId: event.serverUser.id,
    });
  });
}

export function resetRuleSubscribersForTests(): void {
  registered = false;
}
