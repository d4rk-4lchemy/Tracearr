/**
 * The failure-counter release script, against a real Redis (integration)
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getRedis } from '../../src/lib/redisShared.js';
import { RELEASE_SCRIPT } from '../../src/lib/memberLoginPlugin.js';

const KEY = 'tracearr:test:member-login-release';

describe('member login release script', () => {
  afterEach(async () => {
    await getRedis().del(KEY);
  });

  it('hands back a reservation but never takes the count below zero', async () => {
    const redis = getRedis();
    await redis.set(KEY, '2');
    expect(await redis.eval(RELEASE_SCRIPT, 1, KEY)).toBe(1);

    await redis.set(KEY, '0');
    await redis.eval(RELEASE_SCRIPT, 1, KEY);
    expect(await redis.get(KEY)).toBe('0');

    await redis.del(KEY);
    await redis.eval(RELEASE_SCRIPT, 1, KEY);
    expect(await redis.get(KEY)).toBeNull();
  });
});
