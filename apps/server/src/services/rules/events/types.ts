import type { RuleV2, ServerType, Session, ViolationSeverity } from '@tracearr/shared';
import type { db } from '../../../db/client.js';
import type { sessions } from '../../../db/schema.js';
import type { ActionResult } from '../executors/index.js';
import type { ViolationInsertResult } from '../../../jobs/poller/violations.js';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SessionRow = typeof sessions.$inferSelect;

export type TriggerType =
  | 'session.started'
  | 'session.transcode_changed'
  | 'session.paused'
  | 'session.held_for'
  | 'session.resumed'
  | 'session.stopped'
  | 'session.media_changed'
  | 'account.inactive_for';

/** What every producer already holds about the server; matches SessionCreationInput['server']. */
export interface EvaluationServer {
  id: string;
  name: string;
  type: ServerType;
}

/** What every producer already holds about the account; matches SessionCreationInput['serverUser']. */
export interface EvaluationServerUser {
  id: string;
  userId: string;
  username: string;
  thumbUrl: string | null;
  identityName: string | null;
  trustScore: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  identityServerUserIds: string[];
}

export interface PauseData {
  lastPausedAt: Date | null;
  pausedDurationMs: number;
}

interface BaseEvent {
  at: Date;
}

interface SessionEventBase extends BaseEvent {
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  session: Session;
}

export interface SessionStartedEvent extends SessionEventBase {
  type: 'session.started';
}

export interface SessionTranscodeChangedEvent extends SessionEventBase {
  type: 'session.transcode_changed';
  previous: { videoDecision: string | null; audioDecision: string | null };
  next: { videoDecision: string | null; audioDecision: string | null };
}

export interface SessionPausedEvent extends SessionEventBase {
  type: 'session.paused';
  pauseData: PauseData;
}

export interface SessionHeldForEvent extends SessionEventBase {
  type: 'session.held_for';
  pauseData: PauseData;
  heldMinutes: number;
}

/** Cancel-only triggers carry ids and no evaluation inputs. */
export interface SessionRefEvent extends BaseEvent {
  type: 'session.resumed' | 'session.stopped' | 'session.media_changed';
  sessionId: string;
  serverId: string;
}

export interface AccountInactiveForEvent extends BaseEvent {
  type: 'account.inactive_for';
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  session: null;
}

export type RuleEvent =
  | SessionStartedEvent
  | SessionTranscodeChangedEvent
  | SessionPausedEvent
  | SessionHeldForEvent
  | SessionRefEvent
  | AccountInactiveForEvent;

/** Distributes over the event union by member so the three-trigger SessionRefEvent resolves for each of its types. */
export type EventOf<T extends TriggerType> = RuleEvent extends infer E
  ? E extends { type: TriggerType }
    ? T extends E['type']
      ? E
      : never
    : never
  : never;

/** Tick-scoped, in-process; passed alongside the event, never part of it. Arrays are by reference. */
export interface EvaluationInputs {
  activeRulesV2: RuleV2[];
  activeSessions: Session[];
  recentSessions: Session[];
  identityServerUserIds?: string[];
}

export interface DispatchOptions {
  /** Evaluate and record inside the caller's transaction (create path). Errors propagate. */
  tx?: DbTx;
  /** Return the act step as a closure instead of running it (create path). */
  deferActions?: boolean;
}

export interface SubscriberResult {
  violations: ViolationInsertResult[];
  deferredActions?: () => Promise<ActionResult[]>;
}

export type Subscriber<T extends TriggerType> = (
  event: EventOf<T>,
  inputs: EvaluationInputs | undefined,
  opts: DispatchOptions
) => Promise<SubscriberResult | void>;

export interface SubscriberOutcome {
  subscriber: string;
  ok: boolean;
  error?: unknown;
}

export interface DispatchResult {
  violations: ViolationInsertResult[];
  deferredActions?: () => Promise<ActionResult[]>;
  outcomes: SubscriberOutcome[];
}

export type { ViolationSeverity };
