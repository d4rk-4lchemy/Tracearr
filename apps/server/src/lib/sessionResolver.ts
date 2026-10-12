/**
 * Resolves an authenticated user from a Better Auth session (cookie or bearer).
 */

import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AuthUser, UserRole } from '@tracearr/shared';
import { canLogin, isStaff } from '@tracearr/shared';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { getAuth } from './auth.js';
import { ACCESS_CACHE_TTL_MS } from './scope.js';

let serverIdsCache: { ids: string[]; fetchedAt: number } | null = null;

export async function getCachedServerIds(): Promise<string[]> {
  if (serverIdsCache && Date.now() - serverIdsCache.fetchedAt < ACCESS_CACHE_TTL_MS) {
    return serverIdsCache.ids;
  }
  const rows = await db.select({ id: servers.id }).from(servers);
  serverIdsCache = { ids: rows.map((r) => r.id), fetchedAt: Date.now() };
  return serverIdsCache.ids;
}

interface BetterAuthSessionResult {
  user: AuthUser;
  // Undefined only if the session shape has no `.session.id` (never true for
  // a real Better Auth response, but kept optional to fail soft rather than throw).
  sessionId: string | undefined;
}

async function loadBetterAuthSession(
  headers: Headers,
  strict = false
): Promise<BetterAuthSessionResult | null> {
  let session;
  try {
    // Force fresh validation against the session store (DB/Redis) instead of
    // trusting the signed cookie-cache blob. cookieCache (lib/auth.ts, 5m TTL)
    // is fine for non-critical reads, but on the authorization path a revoked
    // session (CLI reset, mobile revoke, admin ban) must stop passing auth
    // immediately rather than lingering for up to the cache TTL.
    session = await getAuth().api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
  } catch (err) {
    // Fail closed on lookup errors. Strict callers answer them as an outage
    // instead of a dead session.
    if (strict) throw err;
    return null;
  }
  if (!session) return null;

  const user = session.user as typeof session.user & { role?: UserRole; username?: string | null };
  const role = user.role ?? 'member';
  if (!canLogin(role)) return null;

  const impersonatedBy = session.session?.impersonatedBy;
  // Viewing as another user is a browser session only, never a bearer token.
  if (impersonatedBy && headers.get('authorization')) return null;
  const serverIds = isStaff(role) ? await getCachedServerIds() : [];
  return {
    sessionId: session.session?.id,
    user: {
      userId: user.id,
      username: user.username ?? user.name,
      role,
      serverIds,
      ...(impersonatedBy ? { impersonatedBy } : {}),
    },
  };
}

export async function resolveBetterAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  const resolved = await loadBetterAuthSession(fromNodeHeaders(request.headers));
  return resolved?.user ?? null;
}

/** Same as `resolveBetterAuthUser`, but a failed lookup throws instead of resolving to null. */
export async function resolveBetterAuthUserStrict(
  request: FastifyRequest
): Promise<AuthUser | null> {
  const resolved = await loadBetterAuthSession(fromNodeHeaders(request.headers), true);
  return resolved?.user ?? null;
}

/**
 * Same lookup as `resolveBetterAuthUser`, but also returns the raw Better
 * Auth session id. Used by the WebSocket middleware to detect whether a
 * session belongs to a paired mobile device (via `mobileSessions`), which
 * isn't derivable from the resolved `AuthUser` alone.
 */
export async function resolveBetterAuthSession(
  headers: Headers
): Promise<BetterAuthSessionResult | null> {
  return loadBetterAuthSession(headers);
}
