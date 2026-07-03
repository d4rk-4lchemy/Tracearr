/**
 * Resolves an authenticated user from a Better Auth session (cookie or bearer).
 */

import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AuthUser, UserRole } from '@tracearr/shared';
import { canLogin } from '@tracearr/shared';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { getAuth } from './auth.js';

let serverIdsCache: { ids: string[]; fetchedAt: number } | null = null;
const SERVER_IDS_TTL_MS = 30_000;

export async function getCachedServerIds(): Promise<string[]> {
  if (serverIdsCache && Date.now() - serverIdsCache.fetchedAt < SERVER_IDS_TTL_MS) {
    return serverIdsCache.ids;
  }
  const rows = await db.select({ id: servers.id }).from(servers);
  serverIdsCache = { ids: rows.map((r) => r.id), fetchedAt: Date.now() };
  return serverIdsCache.ids;
}

export async function resolveBetterAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  let session;
  try {
    session = await getAuth().api.getSession({ headers: fromNodeHeaders(request.headers) });
  } catch {
    return null; // fail closed on lookup errors
  }
  if (!session) return null;

  const user = session.user as typeof session.user & { role?: UserRole; username?: string | null };
  const role = user.role ?? 'member';
  if (!canLogin(role)) return null;

  const serverIds = role === 'owner' ? await getCachedServerIds() : [];
  return {
    userId: user.id,
    username: user.username ?? user.name,
    role,
    serverIds,
  };
}
