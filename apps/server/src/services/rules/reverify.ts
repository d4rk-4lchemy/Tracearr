/**
 * Kill Queue Re-verification
 *
 * Re-checks a matched kill_stream condition against current state right
 * before the delayed termination fires. delay_seconds is the sustain window
 * between the original match and this check, so a session that stopped or a
 * condition that cleared in the meantime must abort rather than kill on
 * stale evidence. Builds its evaluation context through the same seams live
 * rule evaluation uses (excludeUncountableSessions, gracePeriodSessionIds,
 * evaluateRulesAsync) so re-verification and live evaluation can never
 * disagree about what counts as an active session.
 *
 * A kill job carries two session ids. The TRIGGER is the session whose match
 * produced the kill; its context (user, server, media, geo, identity,
 * recentSessions) is what the rule matched on, so re-verification rebuilds the
 * evaluation context from the trigger. The TARGET is the session actually
 * terminated - for target: 'triggering' the two are the same, but multi-target
 * (oldest/newest/all_*) and enforceAcrossServers kills point the target at a
 * different session, possibly on another server or account, whose own context
 * never matched the rule. Re-verifying against the target instead of the
 * trigger loses those kills and, for serverId/serverUserId-scoped
 * enforceAcrossServers rules, self-aborts every time on the scope check. The
 * target still owns the already-stopped short-circuit and the termination call.
 *
 * The cache is not a faithful stand-in for "current state" for the triggering
 * session specifically: createSessionWithRulesAtomic skips re-adding it to the
 * cache once a kill job is enqueued for it (wasTerminatedByRule), so at
 * delay_seconds 0 this can run before any poll tick rediscovers it.
 * buildRuleContextSessions (shared with live evaluation) appends the context
 * session back in when the cache list doesn't already carry its id, the same
 * way it appends a freshly-inserted session in createSessionWithRulesAtomic.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { rules, sessions } from '../../db/schema.js';
import { getCacheService } from '../cache.js';
import {
  batchGetIdentityServerUserIds,
  batchGetRecentUserSessions,
  mapRuleRowToRuleV2,
  widenRecentSessionsForMergedIdentities,
} from '../../jobs/poller/database.js';
import { excludeUncountableSessions } from '../../jobs/poller/utils.js';
import { gracePeriodSessionIds } from '../../jobs/poller/processor.js';
import { buildRuleContextSessions } from '../../jobs/poller/sessionLifecycle.js';
import { terminateSession } from '../termination.js';
import { rulesLogger } from '../../utils/logger.js';
import { evaluateRulesAsync } from './engine.js';
import type { EvaluationContext } from './types.js';

export type ReverifyOutcome =
  | 'killed'
  | 'skipped_already_stopped'
  | 'skipped_rule_gone'
  | 'skipped_condition_cleared'
  | 'failed';

export interface ReverifyKillConditionParams {
  /** Session whose match produced this kill. The evaluation context (session,
   *  serverUser, server, identity, recentSessions) is rebuilt from THIS row so
   *  the re-check reproduces the match live evaluation made. */
  triggeringSessionId: string;
  /** Session actually terminated. Equals triggeringSessionId for
   *  target: 'triggering'; differs for oldest/newest/all_* and
   *  enforceAcrossServers kills. */
  targetSessionId: string;
  serverId: string;
  ruleId: string;
  /** Violation the kill_stream match created; carried through to the
   *  termination log so rule kills are attributed to their violation. */
  violationId?: string | null;
  /** Message to display to the user before termination (Plex only). */
  message?: string;
  /** True when a prior attempt of this same BullMQ job already ran (and
   *  failed after termination, e.g. storeActionResults threw). Narrows the
   *  already-stopped idempotency check below to retries only. */
  isRetry?: boolean;
}

export interface ReverifyKillConditionResult {
  outcome: ReverifyOutcome;
  error?: string;
}

/**
 * Re-verify a kill_stream match at fire time and terminate if it still holds.
 * Ownership of the actual termination call lives here rather than in the
 * queue worker, so a "matched" result and a "killed" outcome can never drift
 * apart.
 */
export async function reverifyKillCondition(
  params: ReverifyKillConditionParams
): Promise<ReverifyKillConditionResult> {
  const { triggeringSessionId, targetSessionId, serverId, ruleId, violationId, message, isRetry } =
    params;

  // The TARGET decides the already-stopped short-circuit and is the session we
  // actually terminate.
  const targetRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, targetSessionId),
    with: { server: true, serverUser: true },
  });

  if (!targetRow) {
    return { outcome: 'skipped_already_stopped' };
  }

  if (targetRow.stoppedAt) {
    // A retry only happens after a prior attempt of this exact job got past
    // termination and then threw (e.g. storeActionResults failing) - forceStopped
    // is already on the row we just fetched, so this costs no extra query and
    // avoids relabeling that earlier success as skipped_already_stopped. It
    // can't tell this job's kill apart from an unrelated forced stop (admin,
    // stale sweep) landing in the same narrow retry window; that tradeoff is
    // accepted given how rarely the two coincide within a few seconds.
    if (isRetry && targetRow.forceStopped) {
      return { outcome: 'killed' };
    }
    return { outcome: 'skipped_already_stopped' };
  }

  const [ruleRow] = await db.select().from(rules).where(eq(rules.id, ruleId)).limit(1);
  if (!ruleRow || !ruleRow.isActive || !ruleRow.conditions) {
    return { outcome: 'skipped_rule_gone' };
  }

  const rule = mapRuleRowToRuleV2(ruleRow);

  // Evaluate against the TRIGGER's context, not the target's. The rule matched
  // because of the triggering session (its user, server, media, geo, ...); a
  // multi-target or enforceAcrossServers kill can point at a sibling session on
  // another server/account whose own context never matched the rule (and whose
  // server fails the rule's serverId scope), so re-verifying against the target
  // would lose legitimate kills and, for scoped enforceAcrossServers rules,
  // self-abort every time.
  let contextSession = targetRow;
  if (triggeringSessionId !== targetSessionId) {
    const triggerRow = await db.query.sessions.findFirst({
      where: eq(sessions.id, triggeringSessionId),
      with: { server: true, serverUser: true },
    });

    if (triggerRow && !triggerRow.stoppedAt) {
      contextSession = triggerRow;
    } else if (rule.enforceAcrossServers) {
      // The trigger ended during the delay window, so the as-at-trigger context
      // is gone. For an identity-wide rule the target's own context is still
      // coherent (detection aggregates across the whole identity regardless of
      // which session is "session"), so fall back to it rather than lose the kill.
      contextSession = targetRow;
    } else {
      // Non-identity rule with the trigger gone: the condition can no longer be
      // evaluated as-at-trigger and the target's context never matched on its
      // own, so abort instead of killing on a context that was never checked.
      rulesLogger.info('Kill queue: trigger session gone, aborting kill', {
        triggeringSessionId,
        targetSessionId,
        ruleId,
      });
      return { outcome: 'skipped_condition_cleared' };
    }
  }

  const cacheService = getCacheService();
  const cachedSessions = cacheService ? await cacheService.getAllActiveSessions() : [];
  const countableCachedSessions = excludeUncountableSessions(
    cachedSessions,
    gracePeriodSessionIds()
  );
  // contextSession is missing from countableCachedSessions exactly when this
  // kill was enqueued for the triggering session (see module header) - append
  // it back so conditions like concurrent_streams count it instead of
  // undercounting by one and self-aborting. The target, if it is a different
  // still-playing session, is appended too so it is counted as well.
  //
  // KNOWN RESIDUAL: only the trigger and this job's target are restored. A
  // sibling target of the SAME multi-target match that itself raced into
  // existence after the last cache write is neither of these, so a delay-0
  // re-check can still undercount it by milliseconds. Accepted follow-up.
  let activeSessions = buildRuleContextSessions(countableCachedSessions, contextSession, null);
  if (targetRow.id !== contextSession.id && !activeSessions.some((s) => s.id === targetRow.id)) {
    activeSessions = [...activeSessions, targetRow];
  }

  // Identity aggregation runs unconditionally here, mirroring the live poller
  // (processor.ts) - detection-side identity counting is NOT gated by
  // enforceAcrossServers, that flag only controls whether a MATCHED rule's
  // actions reach sessions beyond the triggering one. Gating this lookup on
  // the flag would let a kill matched under live evaluation's identity-wide
  // count re-verify with single-account context and wrongly self-abort as
  // skipped_condition_cleared. Always re-derived here from the DB rather than
  // trusting the identityServerUserIds snapshot the enqueue payload carries
  // from match time: identity membership (server merges/unmerges) can change
  // during the delay window between match and this re-check.
  const identityMap = await batchGetIdentityServerUserIds([contextSession.serverUser.userId]);
  const identityServerUserIds = identityMap.get(contextSession.serverUser.userId);

  const recentSessionsUserIds =
    identityServerUserIds && identityServerUserIds.length > 1
      ? identityServerUserIds
      : [contextSession.serverUserId];
  const recentSessionsMap = await batchGetRecentUserSessions(recentSessionsUserIds);

  // Widen recentSessions across the identity's server_user ids so windowed
  // evaluators (unique_ips_in_window, travel_speed_kmh, ...) see the same
  // cross-server history live evaluation matched on, not just this session's
  // own account - otherwise a cross-server match can silently fail to
  // reproduce here and abort as skipped_condition_cleared.
  if (identityServerUserIds && identityServerUserIds.length > 1) {
    await widenRecentSessionsForMergedIdentities(
      recentSessionsMap,
      new Map([[contextSession.serverUser.userId, identityServerUserIds]])
    );
  }

  // The context session's own row is present in recentSessions by re-verify
  // time (it has been persisted). The evaluators exclude the current session by
  // object reference, not id, and contextSession is a different object than its
  // recent-sessions row, so drop it by id here - otherwise travel_speed_kmh and
  // friends compare the session against itself (0 km, speed 0) and clear.
  const recentSessions = (recentSessionsMap.get(contextSession.serverUserId) ?? []).filter(
    (s) => s.id !== contextSession.id
  );

  const baseContext: Omit<EvaluationContext, 'rule'> = {
    session: contextSession,
    serverUser: contextSession.serverUser,
    server: contextSession.server,
    activeSessions,
    recentSessions,
    identityServerUserIds,
  };

  const results = await evaluateRulesAsync(baseContext, [rule]);
  const matched = results.some((r) => r.ruleId === rule.id && r.matched);

  if (!matched) {
    return { outcome: 'skipped_condition_cleared' };
  }

  try {
    const result = await terminateSession({
      sessionId: targetSessionId,
      trigger: 'rule',
      ruleId,
      violationId: violationId ?? undefined,
      reason: message,
    });

    if (!result.success) {
      return { outcome: 'failed', error: result.error ?? 'Termination failed' };
    }

    rulesLogger.info('Kill queue: terminated session after re-verification', {
      triggeringSessionId,
      targetSessionId,
      serverId,
      ruleId,
    });

    return { outcome: 'killed' };
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : 'Unknown termination error',
    };
  }
}
