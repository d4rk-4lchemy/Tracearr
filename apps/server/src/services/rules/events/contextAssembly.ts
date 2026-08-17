import { eq } from 'drizzle-orm';
import type { ActiveSession, RuleV2, Server, ServerUser, Session } from '@tracearr/shared';
import { db } from '../../../db/client.js';
import { servers, serverUsers, users } from '../../../db/schema.js';
import {
  batchGetRecentUserSessions,
  maxWindowHoursFromRules,
  mergeRecentSessionsForIdentity,
} from '../../../jobs/poller/database.js';
import { mapSessionRow } from '../../../jobs/poller/sessionMapper.js';
import { excludeUncountableSessions } from '../../../jobs/poller/utils.js';
import { rulesLogger } from '../../../utils/logger.js';
import { getIdentityServerUserIds } from '../../userService.js';
import type {
  EvaluationInputs,
  EvaluationServer,
  EvaluationServerUser,
  SessionRow,
} from './types.js';

export interface ContextAssemblyDeps {
  getAllActiveSessions: () => Promise<ActiveSession[]>;
  gracePeriodSessionIds: () => Set<string>;
}

let deps: ContextAssemblyDeps | null = null;

/** Wired by initializePoller: the active-session cache and the poller's grace map are producer state. */
export function setContextAssemblyDeps(next: ContextAssemblyDeps): void {
  deps = next;
}

export function toRuleServer(server: EvaluationServer): Server {
  return {
    id: server.id,
    name: server.name,
    type: server.type,
    url: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function toRuleServerUser(serverUser: EvaluationServerUser, serverId: string): ServerUser {
  return {
    id: serverUser.id,
    userId: serverUser.userId,
    serverId,
    externalId: '',
    username: serverUser.username,
    email: null,
    thumbUrl: serverUser.thumbUrl,
    isServerAdmin: false,
    trustScore: serverUser.trustScore,
    joinedAt: null,
    lastActivityAt: serverUser.lastActivityAt,
    createdAt: serverUser.createdAt,
    removedAt: null,
    updatedAt: new Date(),
    identityName: serverUser.identityName,
  };
}

/** One Session builder for every trigger: the stored row plus whatever the fresh payload overrides. */
export function toRuleSession(row: SessionRow, live?: Partial<Session>): Session {
  return { ...mapSessionRow(row), ...live };
}

/** The eight-column server-user shape the rule pipeline reads, by server-user id. */
export async function loadEvaluationServerUser(
  serverUserId: string
): Promise<Omit<EvaluationServerUser, 'identityServerUserIds'> | null> {
  const [su] = await db
    .select({
      id: serverUsers.id,
      userId: serverUsers.userId,
      username: serverUsers.username,
      thumbUrl: serverUsers.thumbUrl,
      identityName: users.name,
      trustScore: serverUsers.trustScore,
      lastActivityAt: serverUsers.lastActivityAt,
      createdAt: serverUsers.createdAt,
    })
    .from(serverUsers)
    .innerJoin(users, eq(serverUsers.userId, users.id))
    .where(eq(serverUsers.id, serverUserId))
    .limit(1);
  return su ?? null;
}

/** Refs plus inputs for producers that hold only ids (SSE updates, wakes); the poller already has the rows. */
export async function loadEvaluationContext(
  serverId: string,
  serverUserId: string,
  rules: RuleV2[]
): Promise<{
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  inputs: EvaluationInputs;
} | null> {
  const su = await loadEvaluationServerUser(serverUserId);
  if (!su) return null;
  const [srv] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!srv) return null;
  const server: EvaluationServer = { id: srv.id, name: srv.name, type: srv.type };
  const serverUser: EvaluationServerUser = { ...su, identityServerUserIds: [] };
  const inputs = await assembleEvaluationInputs({ rules, server, serverUser });
  serverUser.identityServerUserIds = inputs.identityServerUserIds ?? [];
  return { server, serverUser, inputs };
}

/**
 * The SSE processor and the wake scheduler have no tick; this builds the inputs the poller
 * carries per tick. Failed identity/recent lookups degrade to this server_user only.
 */
export async function assembleEvaluationInputs(args: {
  rules: RuleV2[];
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
}): Promise<EvaluationInputs> {
  const { rules, serverUser } = args;
  if (rules.length === 0) {
    return {
      activeRulesV2: rules,
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: serverUser.identityServerUserIds,
    };
  }
  if (!deps) throw new Error('setContextAssemblyDeps has not been called');

  const activeSessions = excludeUncountableSessions(
    await deps.getAllActiveSessions(),
    deps.gracePeriodSessionIds()
  );

  let identityServerUserIds: string[];
  try {
    identityServerUserIds = await getIdentityServerUserIds(serverUser.userId);
  } catch (error) {
    rulesLogger.error('Failed to resolve identity server users, evaluating this server only', {
      serverUserId: serverUser.id,
      error,
    });
    identityServerUserIds = [serverUser.id];
  }

  const recentSessions = await fetchRecentSessionsForIdentity(
    serverUser.id,
    identityServerUserIds,
    maxWindowHoursFromRules(rules)
  );

  return { activeRulesV2: rules, activeSessions, recentSessions, identityServerUserIds };
}

/** History for windowed rules across every server_user of the identity; a failed wide read falls back to this server alone. */
export async function fetchRecentSessionsForIdentity(
  serverUserId: string,
  identityServerUserIds: string[],
  windowHours?: number
): Promise<Session[]> {
  const ids = identityServerUserIds.length > 1 ? identityServerUserIds : [serverUserId];
  try {
    const recentMap = await batchGetRecentUserSessions(ids, windowHours);
    return mergeRecentSessionsForIdentity(recentMap, ids);
  } catch (error) {
    rulesLogger.error('Failed to fetch recent sessions, falling back to this server only', {
      serverUserId,
      error,
    });
    const fallback = await batchGetRecentUserSessions([serverUserId], windowHours);
    return fallback.get(serverUserId) ?? [];
  }
}
