import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REDIS_KEYS } from '@tracearr/shared';
import {
  STALE_AFTER_MS,
  admitConnection,
  releaseConnection,
  touchConnections,
} from '../../src/services/publicEvents/registry.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');

describe('public event connection registry', () => {
  beforeEach(async () => {
    await redis.del(REDIS_KEYS.PUBLIC_EVENT_CONNECTIONS('u1'));
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('admits up to max and refuses the next, whichever instance asks', async () => {
    expect(await admitConnection(redis, 'u1', 'a', 2)).toBe(true);
    expect(await admitConnection(redis, 'u1', 'b', 2)).toBe(true);
    expect(await admitConnection(redis, 'u1', 'c', 2)).toBe(false);
    await releaseConnection(redis, 'u1', 'a');
    expect(await admitConnection(redis, 'u1', 'c', 2)).toBe(true);
  });

  it('forgets a connection whose instance stopped heartbeating', async () => {
    const t0 = 1_000_000;
    expect(await admitConnection(redis, 'u1', 'crashed', 1, t0)).toBe(true);
    expect(await admitConnection(redis, 'u1', 'next', 1, t0 + STALE_AFTER_MS - 1)).toBe(false);
    expect(await admitConnection(redis, 'u1', 'next', 1, t0 + STALE_AFTER_MS + 1)).toBe(true);
  });

  it('a heartbeat keeps a connection counted', async () => {
    const t0 = 1_000_000;
    await admitConnection(redis, 'u1', 'live', 1, t0);
    await touchConnections(redis, 'u1', ['live'], t0 + STALE_AFTER_MS);
    expect(await admitConnection(redis, 'u1', 'other', 1, t0 + STALE_AFTER_MS + 1)).toBe(false);
  });
});
