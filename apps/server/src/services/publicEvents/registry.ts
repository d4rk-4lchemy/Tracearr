/**
 * Per-key count of open public event connections across every instance. A
 * ZSET per owner, scored by the last heartbeat, so a crashed instance's
 * connections fall out after STALE_AFTER_MS without anyone releasing them.
 * Admission is one Lua round trip so two instances cannot both admit the
 * last slot.
 */

import { REDIS_KEYS } from '@tracearr/shared';
import type { Redis } from 'ioredis';

export const STALE_AFTER_MS = 75_000;
export const KEY_TTL_MS = 150_000;

const ADMIT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

export async function admitConnection(
  redis: Redis,
  userId: string,
  connId: string,
  max: number,
  now: number = Date.now()
): Promise<boolean> {
  const result = await redis.eval(
    ADMIT_SCRIPT,
    1,
    REDIS_KEYS.PUBLIC_EVENT_CONNECTIONS(userId),
    String(now - STALE_AFTER_MS),
    String(max),
    String(now),
    connId,
    String(KEY_TTL_MS)
  );
  return result === 1;
}

export async function touchConnections(
  redis: Redis,
  userId: string,
  connIds: string[],
  now: number = Date.now()
): Promise<void> {
  if (connIds.length === 0) return;
  const key = REDIS_KEYS.PUBLIC_EVENT_CONNECTIONS(userId);
  const args: (string | number)[] = [];
  for (const id of connIds) args.push(now, id);
  await redis.zadd(key, ...args);
  await redis.pexpire(key, KEY_TTL_MS);
}

export async function releaseConnection(
  redis: Redis,
  userId: string,
  connId: string
): Promise<void> {
  await redis.zrem(REDIS_KEYS.PUBLIC_EVENT_CONNECTIONS(userId), connId);
}
