/**
 * In-memory registry of the public event connections this process holds,
 * and every per-process protection: the instance cap, the write-buffer
 * bound, per-stream coalescing, heartbeats, the lifetime limit, the ready
 * broadcast after a subscriber reconnect, and close on key change, shutdown
 * or maintenance. Per-key counts live in registry.ts because other
 * instances hold connections too. Nothing here touches the DB.
 */

import { startSubscriber, stopSubscriber } from './subscriber.js';
import { admitConnection, releaseConnection, touchConnections } from './registry.js';
import type { ActiveSession } from '@tracearr/shared';
import type { ChannelMessage } from './channel.js';
import type {
  PublicEvent,
  PublicEventType,
  Translated,
} from '../../routes/publicV2/eventsTranslate.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

export const MAX_CONNECTIONS_PER_KEY = 20;
export const MAX_CONNECTIONS_PER_INSTANCE = 100;
export const WRITE_BUFFER_LIMIT_BYTES = 256 * 1024;
export const HEARTBEAT_MS = 25_000;
export const COALESCE_MS = 2_000;
export const MAX_LIFETIME_MS = 30 * 60_000;
export const RETRY_MS = 5_000;
export const OVER_CAP_RETRY_AFTER_S = 30;

export type CloseReason =
  | 'client'
  | 'slow_consumer'
  | 'lifetime'
  | 'key_changed'
  | 'shutdown'
  | 'maintenance'
  | 'write_error';

export interface ConnectionSink {
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  readonly writableLength: number;
  readonly writableEnded: boolean;
  on(event: 'close', cb: () => void): unknown;
}

export interface OpenConnectionInput {
  connId: string;
  userId: string;
  ip: string;
  types: ReadonlySet<PublicEventType>;
  serverId: string | null;
  sink: ConnectionSink;
}

interface Connection extends OpenConnectionInput {
  openedAt: number;
  closed: boolean;
  pending: Map<string, string>;
}

interface Deps {
  redis: Redis;
  log: FastifyBaseLogger;
  translate: (message: ChannelMessage) => Translated | null;
  getActiveSessions: () => Promise<ActiveSession[]>;
  seedLastSeen: (sessions: ActiveSession[]) => void;
  clearLastSeen: () => void;
}

const connections = new Map<string, Connection>();
let deps: Deps | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let flushTimer: NodeJS.Timeout | null = null;
// Resolves true once this process's SUBSCRIBE is acknowledged and the seed has run,
// false if the subscribe failed; null while idle.
let subscribed: Promise<boolean> | null = null;

export function initPublicEventConnections(next: Deps): void {
  deps = next;
}

export function formatFrame(event: PublicEvent): string {
  const envelope = JSON.stringify({ type: event.type, at: event.at, data: event.data });
  return `event: ${event.type}\ndata: ${envelope}\n\n`;
}

export function readyFrame(at: string = new Date().toISOString()): string {
  return `event: ready\ndata: ${JSON.stringify({ type: 'ready', at, data: {} })}\n\n`;
}

export function instanceHasRoom(): boolean {
  return connections.size < MAX_CONNECTIONS_PER_INSTANCE;
}

export async function admitPublicEventConnection(
  userId: string,
  connId: string
): Promise<'ok' | 'key_cap' | 'instance_cap'> {
  if (!deps) throw new Error('public event connections not initialized');
  if (!instanceHasRoom()) return 'instance_cap';
  const admitted = await admitConnection(deps.redis, userId, connId, MAX_CONNECTIONS_PER_KEY);
  return admitted ? 'ok' : 'key_cap';
}

export async function releaseAdmission(userId: string, connId: string): Promise<void> {
  if (!deps) return;
  await releaseConnection(deps.redis, userId, connId).catch(() => undefined);
}

function onMessage(message: ChannelMessage): void {
  if (!deps) return;
  let translated: Translated | null;
  try {
    translated = deps.translate(message);
  } catch (err) {
    deps.log.warn({ err, event: message.event }, 'public event translate failed, message dropped');
    return;
  }
  if (!translated) return;
  if (translated.kind === 'key-changed') {
    closePublicEventConnectionsForUser(translated.userId, 'key_changed');
    return;
  }
  for (const event of translated.events) {
    const frame = formatFrame(event);
    for (const conn of connections.values()) {
      deliver(conn, event, frame);
    }
  }
}

function broadcastReady(): void {
  const frame = readyFrame();
  for (const conn of connections.values()) {
    conn.pending.clear();
    writeRaw(conn, frame);
  }
}

function ensureTimers(): void {
  if (!deps) return;
  if (connections.size !== 1) return;
  const current = deps;
  // The seed waits for the subscribe acknowledgment, so a started or updated seen
  // meanwhile is never overwritten by older cache data.
  const attempt: Promise<boolean> = startSubscriber(current.redis, {
    onMessage,
    onResubscribe: broadcastReady,
    onError: (err) => current.log.warn({ err }, 'public event subscriber error'),
  }).then(async (ok) => {
    // A stop and restart while this subscribe was pending leaves it stale, and its
    // result must not touch the connections that the newer subscriber serves.
    if (subscribed !== attempt) return false;
    if (!ok) {
      closeAllPublicEventConnections('maintenance');
      return false;
    }
    await current
      .getActiveSessions()
      .then((sessions) => current.seedLastSeen(sessions))
      .catch((err: unknown) => current.log.warn({ err }, 'public event snapshot seed failed'));
    return true;
  });
  subscribed = attempt;
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  heartbeatTimer.unref();
  flushTimer = setInterval(flushPending, COALESCE_MS);
  flushTimer.unref();
}

function teardownTimersIfIdle(): void {
  if (connections.size > 0) return;
  // Timers and the subscriber start together, so no timer means nothing to tear down.
  if (!heartbeatTimer) return;
  stopSubscriber();
  deps?.clearLastSeen();
  clearInterval(heartbeatTimer);
  if (flushTimer) clearInterval(flushTimer);
  heartbeatTimer = null;
  flushTimer = null;
  subscribed = null;
}

export function attachPublicEventConnection(input: OpenConnectionInput): Promise<void> {
  if (!deps) throw new Error('public event connections not initialized');
  if (!instanceHasRoom()) throw new Error('instance connection cap reached');
  const conn: Connection = { ...input, openedAt: Date.now(), closed: false, pending: new Map() };
  connections.set(conn.connId, conn);
  conn.sink.on('close', () => finish(conn, 'client'));
  deps.log.info(
    { connId: conn.connId, userId: conn.userId, ip: conn.ip, open: connections.size },
    'public event connection opened'
  );
  ensureTimers();
  return (subscribed ?? Promise.resolve(true)).then((ok) => {
    if (!ok || !writeRaw(conn, `retry: ${RETRY_MS}\n\n`)) return;
    writeRaw(conn, readyFrame());
  });
}

function writeRaw(conn: Connection, chunk: string): boolean {
  if (conn.closed || conn.sink.writableEnded) return false;
  if (conn.sink.writableLength > WRITE_BUFFER_LIMIT_BYTES) {
    close(conn, 'slow_consumer');
    return false;
  }
  try {
    conn.sink.write(chunk);
    return true;
  } catch (err) {
    deps?.log.warn({ err, connId: conn.connId }, 'public event connection write failed');
    close(conn, 'write_error');
    return false;
  }
}

function matches(conn: Connection, event: PublicEvent): boolean {
  if (!conn.types.has(event.type)) return false;
  if (conn.serverId && event.serverId && event.serverId !== conn.serverId) return false;
  return true;
}

// One slot per type and stream: the poller publishes the fat update and the slim
// progress for the same stream milliseconds apart, and both must survive the flush.
function deliver(conn: Connection, event: PublicEvent, frame: string): void {
  if (conn.closed || !matches(conn, event)) return;
  if ((event.type === 'stream.progress' || event.type === 'stream.updated') && event.streamId) {
    conn.pending.set(`${event.type}:${event.streamId}`, frame);
    return;
  }
  if (event.type === 'stream.stopped' && event.streamId) {
    conn.pending.delete(`stream.updated:${event.streamId}`);
    conn.pending.delete(`stream.progress:${event.streamId}`);
  }
  writeRaw(conn, frame);
}

export function deliverToConnection(connId: string, event: PublicEvent): void {
  const conn = connections.get(connId);
  if (conn) deliver(conn, event, formatFrame(event));
}

function flushPending(): void {
  for (const conn of connections.values()) {
    if (conn.pending.size === 0) continue;
    const frames = [...conn.pending.values()];
    conn.pending.clear();
    for (const frame of frames) {
      if (!writeRaw(conn, frame)) break;
    }
  }
}

function heartbeat(): void {
  const now = Date.now();
  const alive = new Map<string, string[]>();
  for (const conn of connections.values()) {
    if (now - conn.openedAt >= MAX_LIFETIME_MS) {
      close(conn, 'lifetime');
      continue;
    }
    if (!writeRaw(conn, ': ping\n\n')) continue;
    const ids = alive.get(conn.userId) ?? [];
    ids.push(conn.connId);
    alive.set(conn.userId, ids);
  }
  if (!deps) return;
  for (const [userId, ids] of alive) {
    touchConnections(deps.redis, userId, ids, now).catch((err: unknown) => {
      deps?.log.warn({ err, userId }, 'public event connection heartbeat failed');
    });
  }
}

function finish(conn: Connection, reason: CloseReason): void {
  if (conn.closed) return;
  conn.closed = true;
  connections.delete(conn.connId);
  conn.pending.clear();
  void releaseAdmission(conn.userId, conn.connId);
  deps?.log.info(
    { connId: conn.connId, userId: conn.userId, ip: conn.ip, reason, open: connections.size },
    'public event connection closed'
  );
  teardownTimersIfIdle();
}

function close(conn: Connection, reason: CloseReason): void {
  if (conn.closed) return;
  finish(conn, reason);
  if (reason === 'slow_consumer' || reason === 'write_error') {
    conn.sink.destroy();
  } else {
    conn.sink.end();
  }
}

export function closePublicEventConnectionsForUser(userId: string, reason: CloseReason): void {
  for (const conn of connections.values()) {
    if (conn.userId === userId) close(conn, reason);
  }
}

export function closeAllPublicEventConnections(reason: CloseReason): void {
  for (const conn of connections.values()) close(conn, reason);
}

export function getPublicEventConnectionStats(): { open: number; byUser: Record<string, number> } {
  const byUser: Record<string, number> = {};
  for (const conn of connections.values()) {
    byUser[conn.userId] = (byUser[conn.userId] ?? 0) + 1;
  }
  return { open: connections.size, byUser };
}

export function resetPublicEventConnectionsForTests(): void {
  for (const conn of connections.values()) {
    conn.closed = true;
    connections.delete(conn.connId);
  }
  teardownTimersIfIdle();
}
