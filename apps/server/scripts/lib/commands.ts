/**
 * Admin recovery commands, shared by cli.ts and the reset-password.ts wrapper.
 *
 * These are last-resort, docker-exec-only tools for self-hosted installs
 * that have no email and no working UI login. Treat every code path here as
 * safety-critical: a bug locks an operator out of their own instance, or
 * worse, leaves a compromised account reachable after a "recovery".
 */

import { randomUUID } from 'node:crypto';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { REDIS_KEYS } from '@tracearr/shared';
import { loadRuntime } from './bootstrap.ts';

export const {
  db,
  users,
  servers,
  serverUsers,
  automationRuns,
  authAccounts,
  authSessions,
  plexAccounts,
  hashPassword,
  setSetting,
  getSetting,
  getRedis,
  closeDatabase,
  closeRedis,
} = await loadRuntime();

export async function shutdown(): Promise<void> {
  await closeDatabase();
  await closeRedis();
}

/**
 * Postgres unique_violation. See https://www.postgresql.org/docs/current/errcodes-appendix.html
 * drizzle-orm wraps the driver error, so the code can be one level down in `.cause`.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === '23505' || err.cause?.code === '23505';
}

/** Same Redis key scheme Better Auth's secondary storage uses - see lib/auth.ts's `rkey`. */
function baKey(key: string): string {
  const prefix = process.env.REDIS_PREFIX ?? '';
  return `${prefix}tracearr:ba:${key}`;
}

/**
 * Deletes every Better Auth session for a user from Redis - the
 * secondary-storage cache Better Auth checks first on every session lookup,
 * so a session whose Redis entry survives is still usable no matter what the
 * database row says. Returns the token list it read, so the caller can
 * delete the matching `auth_sessions` rows itself.
 *
 * The database rows are deliberately NOT deleted here. The caller deletes
 * them inside the same transaction as the password write, which is what
 * makes the whole reset retry-safe: the token list is read fresh from the
 * database on every attempt, so as long as the `auth_sessions` rows still
 * exist, a re-run can always rediscover their Redis keys and try again.
 * Deleting the DB rows first (the old bug) orphans the Redis entries beyond
 * recovery, because the token needed to build their key no longer exists
 * anywhere once the row is gone.
 *
 * A password reset run through this CLI is a lockout/compromise recovery
 * action, so we fail closed here: any session that existed before the reset
 * is killed unconditionally, rather than trusting that a stolen or
 * still-open session is fine to leave alive. If Redis is unreachable this
 * throws, and the caller must run it BEFORE writing the new password, so a
 * broken Redis can never result in a changed password with a pre-existing
 * session still valid.
 */
async function killSessionsInRedis(userId: string): Promise<{ token: string }[]> {
  const sessions = await db
    .select({ token: authSessions.token })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));

  const keys = [
    baKey(`active-sessions-${userId}`),
    ...sessions.map((s: { token: string }) => baKey(s.token)),
  ];

  try {
    await getRedis().del(...keys);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Redis is unreachable, cannot safely invalidate existing sessions (${reason}). ` +
        'The password was NOT changed. Fix Redis connectivity and re-run the command.'
    );
  }

  return sessions;
}

async function findUserByUsername(username: string) {
  // Legacy and Plex-created rows can hold mixed-case usernames, so compare on
  // lower(username) - the same semantics as the login-role unique index.
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .limit(1);
  return user;
}

/**
 * Resets a user's password, creating local credential login if they never
 * had one (e.g. a Plex-only owner). Defaults to the first owner by
 * created_at when no username is given.
 */
export async function resetPasswordCommand(opts: {
  username?: string;
  password: string;
}): Promise<void> {
  const target = opts.username
    ? [await findUserByUsername(opts.username)]
    : await db
        .select()
        .from(users)
        .where(eq(users.role, 'owner'))
        .orderBy(asc(users.createdAt))
        .limit(1);
  const user = target[0];
  if (!user)
    throw new Error(opts.username ? `No user named ${opts.username}` : 'No owner user found');

  const hash = await hashPassword(opts.password);

  // Fail closed BEFORE touching the password: kill every existing session in
  // Redis first. If Redis is unreachable this throws here, and nothing below
  // has run yet, so the old password and every existing session are both
  // still fully intact - safe to just re-run once Redis is back.
  const sessions = await killSessionsInRedis(user.id);

  // Everything that must land together lands in one transaction: the
  // auth_accounts credential, the legacy users.passwordHash, and the
  // auth_sessions rows for the tokens already killed in Redis above. If this
  // fails partway it rolls back completely - the password stays unchanged
  // and the (still-intact) auth_sessions rows let a re-run rediscover the
  // same tokens, so redis.del just no-ops on them and the retry heals clean.
  await db.transaction(async (tx: typeof db) => {
    const [existing] = await tx
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential')))
      .limit(1);

    if (existing) {
      await tx
        .update(authAccounts)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(authAccounts.id, existing.id));
    } else {
      await tx.insert(authAccounts).values({
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: hash,
      });
    }

    await tx
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    if (sessions.length > 0) {
      await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
    }
  });
}

/**
 * Renames a user's login username. Respects the partial unique index on
 * lower(username) for owner and admin - a
 * collision is reported as a clean error with no partial write, since the
 * username + display_username update is a single statement.
 */
export async function setUsernameCommand(opts: {
  identifier: string;
  newUsername: string;
}): Promise<void> {
  const user = await findUserByUsername(opts.identifier);
  if (!user) throw new Error(`No user found for "${opts.identifier}"`);

  const newUsername = opts.newUsername.toLowerCase();

  try {
    await db
      .update(users)
      .set({ username: newUsername, displayUsername: opts.newUsername, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(
        `Username "${newUsername}" is already taken by another login-enabled account`
      );
    }
    throw error;
  }
}

/** Changes a user's email, keeping email_verified true (owner-confirmed via CLI access). */
export async function setEmailCommand(opts: { username: string; newEmail: string }): Promise<void> {
  const user = await findUserByUsername(opts.username);
  if (!user) throw new Error(`No user named ${opts.username}`);

  try {
    await db
      .update(users)
      .set({ email: opts.newEmail, emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`Email "${opts.newEmail}" is already in use by another account`);
    }
    throw error;
  }
}

export interface UserSummary {
  username: string;
  email: string | null;
  role: string;
  loginMethods: string[];
}

/**
 * Lists all users with their login methods, derived from auth_accounts
 * providers. A plex auth_accounts row alone does not grant login (the plex
 * plugin re-checks allow_login at check-pin), so 'plex' is only reported when
 * the linked plex_accounts row actually allows login.
 */
export async function listUsersCommand(): Promise<UserSummary[]> {
  const rows = await db
    .select({ id: users.id, username: users.username, email: users.email, role: users.role })
    .from(users)
    .orderBy(asc(users.createdAt));

  const accounts = await db
    .select({
      userId: authAccounts.userId,
      providerId: authAccounts.providerId,
      accountId: authAccounts.accountId,
    })
    .from(authAccounts);

  const loginPlexAccounts = await db
    .select({ userId: plexAccounts.userId, plexAccountId: plexAccounts.plexAccountId })
    .from(plexAccounts)
    .where(eq(plexAccounts.allowLogin, true));
  const plexLoginKeys = new Set(
    (loginPlexAccounts as { userId: string; plexAccountId: string }[]).map(
      (a) => `${a.userId}:${a.plexAccountId}`
    )
  );

  const methodsByUser = new Map<string, Set<string>>();
  for (const account of accounts as { userId: string; providerId: string; accountId: string }[]) {
    if (
      account.providerId === 'plex' &&
      !plexLoginKeys.has(`${account.userId}:${account.accountId}`)
    ) {
      continue;
    }
    const methods = methodsByUser.get(account.userId) ?? new Set<string>();
    methods.add(account.providerId);
    methodsByUser.set(account.userId, methods);
  }

  return (rows as { id: string; username: string; email: string | null; role: string }[]).map(
    (user) => ({
      username: user.username,
      email: user.email,
      role: user.role,
      loginMethods: Array.from(methodsByUser.get(user.id) ?? []),
    })
  );
}

/** Re-enables local username/password login - recovery when an OIDC misconfig locks the UI. */
export async function enableLocalLoginCommand(): Promise<void> {
  await setSetting('loginMethods', { ...(await getSetting('loginMethods')), local: true });
}

export interface PurgedDispatcharrServer {
  id: string;
  name: string;
  url: string;
}

export interface PurgeDispatcharrResult {
  servers: PurgedDispatcharrServer[];
  redisWarning: string | null;
}

export async function listDispatcharrServers(): Promise<PurgedDispatcharrServer[]> {
  return db
    .select({ id: servers.id, name: servers.name, url: servers.url })
    .from(servers)
    .where(eq(servers.type, 'dispatcharr'))
    .orderBy(asc(servers.createdAt));
}

async function scanRedisKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
}

async function cleanupDispatcharrRedis(serverIds: string[]): Promise<void> {
  if (serverIds.length === 0) return;

  const redis = getRedis();
  const serverIdSet = new Set(serverIds);
  const keysToDelete = new Set<string>([
    ...serverIds.flatMap((serverId) => [
      REDIS_KEYS.SERVER_HEALTH(serverId),
      REDIS_KEYS.SERVER_HEALTH_FAIL_COUNT(serverId),
      REDIS_KEYS.SERVER_CONNECTION(serverId),
    ]),
  ]);

  const activeIds = (await redis.smembers(REDIS_KEYS.ACTIVE_SESSION_IDS)) as string[];
  if (activeIds.length > 0) {
    const sessionKeys = activeIds.map((id) => REDIS_KEYS.SESSION_BY_ID(id));
    const sessionPayloads = await redis.mget(...sessionKeys);
    const activeIdsToRemove: string[] = [];

    for (let i = 0; i < activeIds.length; i++) {
      const payload = sessionPayloads[i];
      if (!payload) continue;
      try {
        const session = JSON.parse(payload) as { serverId?: string };
        if (session.serverId && serverIdSet.has(session.serverId)) {
          activeIdsToRemove.push(activeIds[i]!);
          keysToDelete.add(sessionKeys[i]!);
        }
      } catch {
        // Malformed cache entries are ignored; TTL will clear them.
      }
    }

    if (activeIdsToRemove.length > 0) {
      await redis.srem(REDIS_KEYS.ACTIVE_SESSION_IDS, ...activeIdsToRemove);
    }
  }

  const legacyActiveSessions = await redis.get(REDIS_KEYS.ACTIVE_SESSIONS);
  if (legacyActiveSessions) {
    try {
      const sessions = JSON.parse(legacyActiveSessions) as Array<{ serverId?: string }>;
      const retained = sessions.filter((session) => !serverIdSet.has(session.serverId ?? ''));
      if (retained.length > 0) {
        await redis.set(REDIS_KEYS.ACTIVE_SESSIONS, JSON.stringify(retained), 'KEEPTTL');
      } else {
        keysToDelete.add(REDIS_KEYS.ACTIVE_SESSIONS);
      }
    } catch {
      keysToDelete.add(REDIS_KEYS.ACTIVE_SESSIONS);
    }
  }

  const pendingMembers = (await redis.smembers(REDIS_KEYS.PENDING_SESSION_IDS)) as string[];
  const pendingMembersToRemove = pendingMembers.filter((member) => {
    const [serverId] = member.split(':');
    return serverIdSet.has(serverId ?? '');
  });
  for (const member of pendingMembersToRemove) {
    const [serverId, ...sessionKeyParts] = member.split(':');
    const sessionKey = sessionKeyParts.join(':');
    if (serverId && sessionKey) {
      keysToDelete.add(REDIS_KEYS.PENDING_SESSION(serverId, sessionKey));
    }
  }
  if (pendingMembersToRemove.length > 0) {
    await redis.srem(REDIS_KEYS.PENDING_SESSION_IDS, ...pendingMembersToRemove);
  }

  const dispatcharrKeys = await scanRedisKeys(
    `${process.env.REDIS_PREFIX ?? ''}tracearr:dispatcharr:*`
  );
  for (const key of dispatcharrKeys) keysToDelete.add(key);

  if (keysToDelete.size > 0) {
    await redis.del(...keysToDelete);
  }
}


export interface PurgedChannelsDvrServer {
  id: string;
  name: string;
  url: string;
}

export interface PurgeChannelsDvrResult {
  servers: PurgedChannelsDvrServer[];
  redisWarning: string | null;
}

export async function listChannelsDvrServers(): Promise<PurgedChannelsDvrServer[]> {
  return db
    .select({ id: servers.id, name: servers.name, url: servers.url })
    .from(servers)
    .where(eq(servers.type, 'channels_dvr'))
    .orderBy(asc(servers.createdAt));
}

async function cleanupChannelsDvrRedis(serverIds: string[]): Promise<void> {
  if (serverIds.length === 0) return;

  const redis = getRedis();
  const serverIdSet = new Set(serverIds);
  const keysToDelete = new Set<string>(
    serverIds.flatMap((serverId) => [
      REDIS_KEYS.SERVER_HEALTH(serverId),
      REDIS_KEYS.SERVER_HEALTH_FAIL_COUNT(serverId),
      REDIS_KEYS.SERVER_CONNECTION(serverId),
      REDIS_KEYS.SERVER_STATS_SAMPLES(serverId),
      REDIS_KEYS.SERVER_STATS_CHANNELS_DVR_FETCH(serverId),
    ])
  );

  const activeIds = (await redis.smembers(REDIS_KEYS.ACTIVE_SESSION_IDS)) as string[];
  if (activeIds.length > 0) {
    const sessionKeys = activeIds.map((id) => REDIS_KEYS.SESSION_BY_ID(id));
    const sessionPayloads = await redis.mget(...sessionKeys);
    const activeIdsToRemove: string[] = [];

    for (let i = 0; i < activeIds.length; i++) {
      const payload = sessionPayloads[i];
      if (!payload) continue;
      try {
        const session = JSON.parse(payload) as { serverId?: string };
        if (session.serverId && serverIdSet.has(session.serverId)) {
          activeIdsToRemove.push(activeIds[i]!);
          keysToDelete.add(sessionKeys[i]!);
        }
      } catch {
        // Malformed cache entries are ignored; TTL will clear them.
      }
    }

    if (activeIdsToRemove.length > 0) {
      await redis.srem(REDIS_KEYS.ACTIVE_SESSION_IDS, ...activeIdsToRemove);
    }
  }

  const legacyActiveSessions = await redis.get(REDIS_KEYS.ACTIVE_SESSIONS);
  if (legacyActiveSessions) {
    try {
      const sessions = JSON.parse(legacyActiveSessions) as Array<{ serverId?: string }>;
      const retained = sessions.filter((session) => !serverIdSet.has(session.serverId ?? ''));
      if (retained.length > 0) {
        await redis.set(REDIS_KEYS.ACTIVE_SESSIONS, JSON.stringify(retained), 'KEEPTTL');
      } else {
        keysToDelete.add(REDIS_KEYS.ACTIVE_SESSIONS);
      }
    } catch {
      // This is a shared legacy index. Never delete it when its contents
      // cannot be parsed, because it may still contain other integrations.
      console.warn(
        'Skipping malformed legacy active-session cache; leaving the shared key untouched.'
      );
    }
  }

  const pendingMembers = (await redis.smembers(REDIS_KEYS.PENDING_SESSION_IDS)) as string[];
  const pendingMembersToRemove = pendingMembers.filter((member) => {
    const [serverId] = member.split(':');
    return serverIdSet.has(serverId ?? '');
  });
  for (const member of pendingMembersToRemove) {
    const [serverId, ...sessionKeyParts] = member.split(':');
    const sessionKey = sessionKeyParts.join(':');
    if (serverId && sessionKey) {
      keysToDelete.add(REDIS_KEYS.PENDING_SESSION(serverId, sessionKey));
    }
  }
  if (pendingMembersToRemove.length > 0) {
    await redis.srem(REDIS_KEYS.PENDING_SESSION_IDS, ...pendingMembersToRemove);
  }

  if (keysToDelete.size > 0) {
    await redis.del(...keysToDelete);
  }
}

export async function purgeChannelsDvrCommand(
  confirmedServerIds: string[]
): Promise<PurgeChannelsDvrResult> {
  // The caller passes the exact IDs shown to the operator before confirmation.
  // Re-check their type inside the transaction so stale IDs or IDs belonging
  // to another integration can never be deleted.
  const requestedServerIds = [...new Set(confirmedServerIds)];
  const deletedServers = await db.transaction(async (tx: typeof db) => {
    if (requestedServerIds.length === 0) return [];

    const channelsDvrServers = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(
          inArray(servers.id, requestedServerIds),
          eq(servers.type, 'channels_dvr')
        )
      );

    const serverIds = channelsDvrServers.map((server: { id: string }) => server.id);
    if (serverIds.length === 0) return [];

    // Capture identities before the server-user cascade removes their accounts.
    const affectedIdentities = await tx
      .selectDistinct({ id: serverUsers.userId })
      .from(serverUsers)
      .where(inArray(serverUsers.serverId, serverIds));
    const affectedUserIds = affectedIdentities.map((identity: { id: string }) => identity.id);

    // automation_runs.server_id intentionally has no FK, so delete these
    // rows before server cascades remove scoped automations and their versions.
    await tx.delete(automationRuns).where(inArray(automationRuns.serverId, serverIds));

    const deleted = await tx
      .delete(servers)
      .where(
        and(
          inArray(servers.id, serverIds),
          eq(servers.type, 'channels_dvr')
        )
      )
      .returning({ id: servers.id, name: servers.name, url: servers.url });

    // Recalculate only the two cached security aggregates. Keep identity-level
    // historical dates unchanged when a media-server account is removed.
    if (affectedUserIds.length > 0) {
      await tx.execute(sql`
        UPDATE ${users} AS u SET
          aggregate_trust_score = coalesce(a.trust, 100),
          total_violations = coalesce(v.count, 0),
          updated_at = now()
        FROM (
          SELECT ${users.id} AS user_id,
            coalesce(
              min(${serverUsers.trustScore}) filter (where ${serverUsers.removedAt} is null),
              min(${serverUsers.trustScore})
            ) AS trust
          FROM ${users}
          LEFT JOIN ${serverUsers} ON ${serverUsers.userId} = ${users.id}
          WHERE ${inArray(users.id, affectedUserIds)}
          GROUP BY ${users.id}
        ) AS a
        LEFT JOIN (
          SELECT ${serverUsers.userId} AS user_id, count(*)::int AS count
          FROM ${automationRuns}
          INNER JOIN ${serverUsers} ON ${automationRuns.serverUserId} = ${serverUsers.id}
          WHERE ${and(
            inArray(serverUsers.userId, affectedUserIds),
            sql`${automationRuns.dismissedAt} IS NULL`,
            eq(automationRuns.kind, 'policy'),
            eq(automationRuns.outcome, 'completed')
          )}
          GROUP BY ${serverUsers.userId}
        ) AS v ON v.user_id = a.user_id
        WHERE u.id = a.user_id
      `);
    }

    return deleted;
  });

  let redisWarning: string | null = null;
  try {
    await cleanupChannelsDvrRedis(
      (deletedServers as PurgedChannelsDvrServer[]).map((server) => server.id)
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    redisWarning = `Redis cleanup failed after database purge: ${reason}`;
  }

  return { servers: deletedServers as PurgedChannelsDvrServer[], redisWarning };
}

export async function purgeDispatcharrCommand(): Promise<PurgeDispatcharrResult> {
  const deletedServers = await db.transaction(async (tx: typeof db) => {
    const deleted = await tx
      .delete(servers)
      .where(eq(servers.type, 'dispatcharr'))
      .returning({ id: servers.id, name: servers.name, url: servers.url });

    // Restore the fork-owned schema before handing the database to the
    // upstream Tracearr image. IF EXISTS keeps this safe for databases that
    // already ran the fork cleanup migration, and also covers older fork
    // versions which still had progress_estimated or the live-history column.
    await tx.execute(sql`
      ALTER TABLE "servers"
        DROP COLUMN IF EXISTS "ignore_anonymous_streams",
        DROP COLUMN IF EXISTS "dispatcharr_live_history_threshold_seconds"
    `);
    await tx.execute(sql`
      ALTER TABLE "sessions"
        DROP COLUMN IF EXISTS "dispatcharr_playback_kind",
        DROP COLUMN IF EXISTS "progress_estimated"
    `);

    return deleted;
  });

  let redisWarning: string | null = null;
  try {
    await cleanupDispatcharrRedis(
      (deletedServers as PurgedDispatcharrServer[]).map((server) => server.id)
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    redisWarning = `Redis cleanup failed after database purge: ${reason}`;
  }

  return { servers: deletedServers as PurgedDispatcharrServer[], redisWarning };
}
