/**
 * Channel messages become public events here, once per process per message.
 * The internal payload shapes stay private; this file is the only place that
 * knows both sides. No DB: stream.stopped carries the last snapshot this
 * process holds, from live events or from the session cache it was seeded
 * with, or null for a session that was never in that cache.
 */

import {
  WS_EVENTS,
  type ActiveSession,
  type ServerDownReason,
  type ViolationWithDetails,
} from '@tracearr/shared';
import { buildAvatarUrl } from '../../services/imageProxy.js';
import { formatActiveStream, type ActiveStreamShape } from './streams.js';
import type {
  ChannelMessage,
  SessionsProgressPayload,
} from '../../services/publicEvents/channel.js';
import type { ViolationShape } from './violations.js';

export const PUBLIC_EVENT_TYPES = [
  'stream.started',
  'stream.updated',
  'stream.progress',
  'stream.stopped',
  'violation.created',
  'server.health',
] as const;

export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];

export interface PublicEvent {
  type: PublicEventType;
  at: string;
  serverId: string | null;
  streamId: string | null;
  data: unknown;
}

export type Translated =
  { kind: 'events'; events: PublicEvent[] } | { kind: 'key-changed'; userId: string };

// Bounded so a missed session:stopped cannot grow this forever.
const LAST_SEEN_CAP = 5000;
const lastSeen = new Map<string, ActiveStreamShape>();

function remember(stream: ActiveStreamShape): void {
  lastSeen.delete(stream.id);
  lastSeen.set(stream.id, stream);
  if (lastSeen.size > LAST_SEEN_CAP) {
    const oldest = lastSeen.keys().next().value;
    if (oldest !== undefined) lastSeen.delete(oldest);
  }
}

function isSession(data: unknown): data is ActiveSession {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'serverId' in data &&
    'server' in data
  );
}

function isProgress(data: unknown): data is SessionsProgressPayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as SessionsProgressPayload).sessions)
  );
}

type PublicViolationSource = ViolationWithDetails & {
  user: ViolationWithDetails['user'] & { userId: string };
  server: NonNullable<ViolationWithDetails['server']>;
};

function isViolation(data: unknown): data is PublicViolationSource {
  if (typeof data !== 'object' || data === null) return false;
  const v = data as Partial<ViolationWithDetails>;
  return (
    'ruleId' in v &&
    typeof v.rule === 'object' &&
    typeof v.user === 'object' &&
    v.user !== null &&
    typeof v.user.userId === 'string' &&
    typeof v.server === 'object' &&
    v.server !== null
  );
}

function isHealth(
  data: unknown
): data is { serverId: string; serverName: string; reason?: ServerDownReason } {
  return typeof data === 'object' && data !== null && 'serverId' in data && 'serverName' in data;
}

function one(
  at: string,
  type: PublicEventType,
  serverId: string | null,
  streamId: string | null,
  data: unknown
): Translated {
  return { kind: 'events', events: [{ type, at, serverId, streamId, data }] };
}

export function translateChannelMessage(message: ChannelMessage): Translated | null {
  const { event, data, at } = message;

  if (event === WS_EVENTS.SESSION_STARTED || event === WS_EVENTS.SESSION_UPDATED) {
    if (!isSession(data)) return null;
    const stream = formatActiveStream(data);
    remember(stream);
    const type = event === WS_EVENTS.SESSION_STARTED ? 'stream.started' : 'stream.updated';
    return one(at, type, stream.server_id, stream.id, stream);
  }

  if (event === WS_EVENTS.SESSION_STOPPED) {
    if (typeof data !== 'string') return null;
    const stream = lastSeen.get(data) ?? null;
    lastSeen.delete(data);
    return one(at, 'stream.stopped', stream?.server_id ?? null, data, {
      id: data,
      server_id: stream?.server_id ?? null,
      stream,
    });
  }

  if (event === WS_EVENTS.SESSIONS_PROGRESS) {
    if (!isProgress(data)) return null;
    return {
      kind: 'events',
      events: data.sessions.map((s) => ({
        type: 'stream.progress',
        at,
        serverId: s.serverId,
        streamId: s.id,
        data: {
          id: s.id,
          server_id: s.serverId,
          state: s.state,
          progress_ms: s.progressMs,
          bitrate: s.bitrate,
        },
      })),
    };
  }

  if (event === WS_EVENTS.VIOLATION_NEW) {
    if (!isViolation(data)) return null;
    const violation: ViolationShape = {
      id: data.id,
      severity: data.severity,
      created_at: new Date(data.createdAt).toISOString(),
      acknowledged_at: data.acknowledgedAt ? new Date(data.acknowledgedAt).toISOString() : null,
      session_id: data.sessionId,
      rule: { id: data.rule.id, name: data.rule.name },
      server: { id: data.server.id, name: data.server.name, type: data.server.type },
      user: {
        id: data.user.userId,
        server_user_id: data.user.id,
        username: data.user.identityName ?? data.user.username,
        thumb_url: data.user.thumbUrl,
        avatar_url: buildAvatarUrl(data.user.serverId, data.user.thumbUrl),
      },
      data: data.data,
    };
    return one(at, 'violation.created', violation.server.id, violation.session_id, violation);
  }

  if (event === WS_EVENTS.SERVER_DOWN || event === WS_EVENTS.SERVER_UP) {
    if (!isHealth(data)) return null;
    return one(at, 'server.health', data.serverId, null, {
      server_id: data.serverId,
      server_name: data.serverName,
      status: event === WS_EVENTS.SERVER_DOWN ? 'down' : 'up',
      reason: data.reason ?? null,
    });
  }

  if (event === WS_EVENTS.PUBLIC_API_KEY_CHANGED) {
    const userId = (data as { userId?: unknown } | null)?.userId;
    return typeof userId === 'string' ? { kind: 'key-changed', userId } : null;
  }

  return null;
}

/**
 * Called once when a process's subscriber starts, after the subscribe, with
 * the active session cache. Fills only ids the map does not hold, so a
 * started or updated seen during the cache read keeps its fresher snapshot.
 */
export function seedLastSeen(sessions: ActiveSession[]): void {
  for (const session of sessions) {
    if (lastSeen.has(session.id)) continue;
    remember(formatActiveStream(session));
  }
}

export function clearLastSeen(): void {
  lastSeen.clear();
}
