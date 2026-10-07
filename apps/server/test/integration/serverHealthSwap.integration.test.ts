/**
 * Server health swap against real Redis.
 *
 * The poller and the SSE reconnect both flip the health key, and each sends an
 * up or down only when its own swap replaced the opposite value. A mocked
 * client can't show that the GET and SETEX run as one step, so this pins it.
 *
 * Run with: pnpm --filter @tracearr/server test:integration serverHealthSwap
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { CACHE_TTL, REDIS_KEYS } from '@tracearr/shared';
import { createCacheService } from '../../src/services/cache.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
const redis = new Redis(redisUrl);
const otherRedis = new Redis(redisUrl);
const cache = createCacheService(redis);
const otherCache = createCacheService(otherRedis);
const serverId = 'health-swap-server';

describe('setServerHealth', () => {
  beforeEach(async () => {
    await redis.del(REDIS_KEYS.SERVER_HEALTH(serverId));
  });

  afterAll(async () => {
    await redis.del(REDIS_KEYS.SERVER_HEALTH(serverId));
    redis.disconnect();
    otherRedis.disconnect();
  });

  it('returns the value it replaced and sets the TTL', async () => {
    expect(await cache.setServerHealth(serverId, true)).toBeNull();
    expect(await cache.setServerHealth(serverId, false)).toBe(true);
    expect(await cache.setServerHealth(serverId, true)).toBe(false);
    expect(await redis.ttl(REDIS_KEYS.SERVER_HEALTH(serverId))).toBe(CACHE_TTL.SERVER_HEALTH);
  });

  it('reads an unauthorized down back as false and keeps its reason', async () => {
    await cache.setServerHealth(serverId, false, 'unauthorized');

    expect(await cache.getServerDownReason(serverId)).toBe('unauthorized');
    expect(await cache.setServerHealth(serverId, false, 'unauthorized')).toBe(false);
  });

  it('gives exactly one of two concurrent swaps from separate clients the down it replaced', async () => {
    await cache.setServerHealth(serverId, false);

    const previous = await Promise.all([
      cache.setServerHealth(serverId, true),
      otherCache.setServerHealth(serverId, true),
    ]);

    expect(previous.filter((value) => value === false)).toHaveLength(1);
  });
});
