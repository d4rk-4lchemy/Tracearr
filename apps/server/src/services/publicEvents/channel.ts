/**
 * The pub/sub channel behind GET /api/v2/public/events. Every allowlisted
 * internal publish is repeated here with the internal payload; each
 * process's subscriber translates to the public shape. Pub/sub stores
 * nothing: a process that is not subscribed misses the event, and the
 * client contract (refetch on ready) covers that.
 */

import { REDIS_KEYS, WS_EVENTS } from '@tracearr/shared';
import type { Redis } from 'ioredis';

export const PUBLIC_CHANNEL_EVENTS: ReadonlySet<string> = new Set([
  WS_EVENTS.SESSION_STARTED,
  WS_EVENTS.SESSION_UPDATED,
  WS_EVENTS.SESSION_STOPPED,
  WS_EVENTS.SESSIONS_PROGRESS,
  WS_EVENTS.VIOLATION_NEW,
  WS_EVENTS.SERVER_DOWN,
  WS_EVENTS.SERVER_UP,
  WS_EVENTS.PUBLIC_API_KEY_CHANGED,
]);

export interface ChannelMessage {
  event: string;
  data: unknown;
  at: string;
}

export interface SessionsProgressPayload {
  sessions: Array<{
    id: string;
    serverId: string;
    state: string;
    progressMs: number;
    bitrate: number | null;
  }>;
}

export async function publishPublicEvent(
  publisher: Redis,
  event: string,
  data: unknown
): Promise<void> {
  await publisher.publish(
    REDIS_KEYS.PUBLIC_EVENTS_CHANNEL,
    JSON.stringify({ event, data, at: new Date().toISOString() })
  );
}

export function parseChannelMessage(raw: string): ChannelMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { event, data, at } = parsed as Partial<ChannelMessage>;
  if (typeof event !== 'string' || typeof at !== 'string' || !('data' in parsed)) return null;
  return { event, data, at };
}
