/**
 * Socket.io WebSocket server setup
 */

import type { IncomingMessage, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AuthUser,
  ActiveSession,
} from '@tracearr/shared';
import { WS_EVENTS, REDIS_KEYS, isStaff } from '@tracearr/shared';
import type { Redis } from 'ioredis';
import { db } from '../db/client.js';
import { mobileSessions, serverUsers } from '../db/schema.js';
import { resolveBetterAuthSession } from '../lib/sessionResolver.js';
import { isTrustedOrigin, requestHost } from '../lib/origins.js';
import { isTokenRevoked } from '../plugins/auth.js';
import { ACCESS_CACHE_TTL_MS } from '../lib/scope.js';
import { getPubSubService } from '../services/cache.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketData {
  user: AuthUser;
}

let io: TypedServer | null = null;
let redis: Redis | null = null;

// A session's account never changes, so session:stopped (which carries only the id) is routed
// through it. An account's person does change, on merge and split, so that mapping expires and
// is dropped whenever the person's access changes. A session whose stop never arrives here keeps
// its account entry until restart.
const sessionAccounts = new Map<string, string>();
const accountOwners = new Map<string, { userId: string; at: number }>();
// Member delivery runs in arrival order per session, so a stop never overtakes the start before it.
const memberDeliveries = new Map<string, Promise<void>>();

function seesAllSessions(user: AuthUser): boolean {
  return isStaff(user.role);
}

/**
 * Verify JWT token for WebSocket connections
 */
function verifyToken(token: string): AuthUser {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }

  const decoded = jwt.verify(token, secret) as AuthUser & { iat?: number };
  if (isTokenRevoked(decoded.iat)) throw new Error('token revoked');
  return decoded;
}

/**
 * Resolves the authenticated user for a Socket.io handshake: legacy JWT
 * first (mobile shim, old web tabs), then a Better Auth session (bearer
 * token or cookie). Any resolution error denies the connection (fail-closed).
 *
 * Better Auth bearer tokens carry no `deviceId`, so mobile status for those
 * sessions is derived by looking up `mobileSessions` by `betterAuthSessionId`;
 * a match means the connection is a paired mobile device (and needs the
 * blacklist check below), no match means it's a web session.
 */
export async function resolveSocketUser(handshake: {
  token: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}): Promise<AuthUser | null> {
  if (handshake.token) {
    try {
      return verifyToken(handshake.token);
    } catch {
      // fall through to better auth
    }
  }

  try {
    const headers = new Headers();
    if (handshake.token) headers.set('authorization', `Bearer ${handshake.token}`);
    const cookie = handshake.headers.cookie;
    if (cookie) headers.set('cookie', Array.isArray(cookie) ? cookie.join('; ') : cookie);

    const resolved = await resolveBetterAuthSession(headers);
    if (!resolved) return null;
    if (!resolved.sessionId) return resolved.user;

    const [mobileRow] = await db
      .select({ deviceId: mobileSessions.deviceId })
      .from(mobileSessions)
      .where(eq(mobileSessions.betterAuthSessionId, resolved.sessionId))
      .limit(1);

    if (!mobileRow) return resolved.user;
    return { ...resolved.user, mobile: true, deviceId: mobileRow.deviceId };
  } catch {
    return null;
  }
}

/**
 * Checks whether a mobile device's token has been blacklisted (revoked).
 * Fails closed: any Redis error denies the connection rather than letting
 * it through unverified.
 */
export async function checkMobileBlacklist(redisClient: Redis, deviceId: string): Promise<boolean> {
  try {
    const blacklisted = await redisClient.get(REDIS_KEYS.MOBILE_BLACKLISTED_TOKEN(deviceId));
    return !blacklisted;
  } catch (err) {
    console.error('[WebSocket] Blacklist check error:', err);
    return false;
  }
}

export function initializeWebSocket(
  httpServer: HttpServer,
  basePath = '',
  redisClient?: Redis
): TypedServer {
  if (redisClient) {
    redis = redisClient;
  }
  // Recovery from maintenance runs post-listen init again on the same http
  // server. A second Server would take new connections while every client
  // still attached to the first one silently stops receiving broadcasts.
  if (io) return io;

  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    // The same rule as the REST API: credentials only for an origin Tracearr trusts.
    cors: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, {
        // engine.io hands the cors package its raw IncomingMessage.
        origin: !!origin && isTrustedOrigin(origin, requestHost(req as IncomingMessage)),
        credentials: true,
      });
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || isTrustedOrigin(origin, requestHost(req)));
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // No connectionStateRecovery: it replays missed packets to the old rooms before auth runs.
    // Clients refetch on every reconnect instead.
    // When basePath is set, Socket.io must listen on the prefixed path.
    // Socket.io runs on the raw HTTP server (not Fastify), so rewriteUrl doesn't apply.
    ...(basePath && { path: `${basePath}/socket.io` }),
  });

  // Authentication middleware
  io.use((socket: TypedSocket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    const headers = socket.handshake.headers as Record<string, string | string[] | undefined>;

    resolveSocketUser({ token, headers })
      .then((user) => {
        if (!user) {
          next(new Error('Authentication failed'));
          return;
        }

        // Check if this mobile device's token has been blacklisted (revoked)
        if (user.mobile && user.deviceId && redis) {
          void checkMobileBlacklist(redis, user.deviceId).then((allowed) => {
            if (allowed) {
              (socket.data as SocketData).user = user;
              next();
            } else {
              next(new Error('Session has been revoked'));
            }
          });
          return;
        }

        (socket.data as SocketData).user = user;
        next();
      })
      .catch((error: unknown) => {
        console.error('[WebSocket] Auth error:', error);
        next(new Error('Authentication failed'));
      });
  });

  io.on('connection', (socket: TypedSocket) => {
    const user = (socket.data as SocketData).user;
    console.log(
      `[WebSocket] Client connected: ${socket.id} (user: ${user?.username ?? 'unknown'})`
    );

    // Join user-specific room for targeted messages
    if (user?.userId) {
      void socket.join(`user:${user.userId}`);
    }

    // Join device-specific room for mobile clients (enables targeted disconnect)
    if (user?.mobile && user?.deviceId) {
      void socket.join(`mobile:${user.deviceId}`);
    }

    if (user && seesAllSessions(user)) {
      for (const serverId of user.serverIds) {
        void socket.join(`server:${serverId}`);
      }
      void socket.join('sessions');
    } else if (user?.userId) {
      void socket.join(`member:${user.userId}`);
    }

    socket.on(WS_EVENTS.SUBSCRIBE_SESSIONS, () => {
      if (!user || !seesAllSessions(user)) return;
      void socket.join('sessions');
      console.log(`[WebSocket] ${socket.id} subscribed to sessions`);
    });

    socket.on(WS_EVENTS.UNSUBSCRIBE_SESSIONS, () => {
      void socket.leave('sessions');
      console.log(`[WebSocket] ${socket.id} unsubscribed from sessions`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  console.log('[WebSocket] Server initialized');
  return io;
}

export function disconnectAllSockets(): void {
  io?.disconnectSockets(true);
}

export function getIO(): TypedServer {
  if (!io) {
    throw new Error('WebSocket server not initialized');
  }
  return io;
}

export function broadcastToSessions<K extends keyof ServerToClientEvents>(
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
): void {
  if (io) {
    (io.to('sessions').emit as (event: K, ...args: Parameters<ServerToClientEvents[K]>) => void)(
      event,
      ...args
    );
  }
}

async function personOf(serverUserId: string): Promise<string | undefined> {
  const cached = accountOwners.get(serverUserId);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.userId;
  const [row] = await db
    .select({ userId: serverUsers.userId })
    .from(serverUsers)
    .where(eq(serverUsers.id, serverUserId))
    .limit(1);
  if (!row) return undefined;
  accountOwners.set(serverUserId, { userId: row.userId, at: Date.now() });
  return row.userId;
}

function deliverToMember(sessionId: string, deliver: () => Promise<void>): Promise<void> {
  const next = (memberDeliveries.get(sessionId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(deliver);
  memberDeliveries.set(sessionId, next);
  const settle = () => {
    if (memberDeliveries.get(sessionId) === next) memberDeliveries.delete(sessionId);
  };
  next.then(settle, settle);
  return next;
}

/** Emits to the sessions room at once, then to the owning member's room. */
export function broadcastSessionEvent(
  event: 'session:started' | 'session:updated',
  session: ActiveSession
): Promise<void> {
  broadcastToSessions(event, session);
  if (!io) return Promise.resolve();
  sessionAccounts.set(session.id, session.serverUserId);
  return deliverToMember(session.id, async () => {
    const userId = await personOf(session.serverUserId);
    if (userId) io?.to(`member:${userId}`).emit(event, session);
  });
}

export function broadcastSessionStopped(sessionId: string): Promise<void> {
  broadcastToSessions('session:stopped', sessionId);
  const serverUserId = sessionAccounts.get(sessionId);
  if (!io || !serverUserId) return Promise.resolve();
  sessionAccounts.delete(sessionId);
  return deliverToMember(sessionId, async () => {
    const userId = await personOf(serverUserId);
    if (userId) io?.to(`member:${userId}`).emit('session:stopped', sessionId);
  });
}

export function broadcastToServer<K extends keyof ServerToClientEvents>(
  serverId: string,
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
): void {
  if (io) {
    (
      io.to(`server:${serverId}`).emit as (
        event: K,
        ...args: Parameters<ServerToClientEvents[K]>
      ) => void
    )(event, ...args);
  }
}

/**
 * Force-disconnect a revoked mobile device's sockets on every instance, through the same pub/sub
 * relay as disconnectUserSockets.
 */
export async function disconnectMobileDevice(deviceId: string): Promise<void> {
  const pubSub = getPubSubService();
  if (pubSub) {
    await pubSub.publish(WS_EVENTS.MOBILE_DEVICE_REVOKED, deviceId);
    return;
  }
  dropMobileDeviceSockets(deviceId);
}

/** Scans all connected sockets rather than relying on room membership. */
export function dropMobileDeviceSockets(deviceId: string): void {
  if (!io) return;
  for (const [, socket] of io.sockets.sockets) {
    const user = (socket.data as SocketData).user;
    if (user?.mobile && user.deviceId === deviceId) {
      socket.disconnect(true);
    }
  }
}

/**
 * Drops a person's sockets on every instance, so they reconnect into the rooms their role and
 * accounts now give them. Each instance holds only its own sockets, so this goes through pub/sub
 * and the relay in index.ts calls dropUserSockets; without pub/sub it acts locally.
 */
export async function disconnectUserSockets(userId: string): Promise<void> {
  const pubSub = getPubSubService();
  if (pubSub) {
    await pubSub.publish(WS_EVENTS.USER_ACCESS_CHANGED, userId);
    return;
  }
  dropUserSockets(userId);
}

export function dropUserSockets(userId: string): void {
  for (const [serverUserId, owner] of accountOwners) {
    if (owner.userId === userId) accountOwners.delete(serverUserId);
  }
  if (!io) return;
  for (const [, socket] of io.sockets.sockets) {
    if ((socket.data as SocketData).user?.userId === userId) socket.disconnect(true);
  }
}
