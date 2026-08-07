import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedis, redisInstances } = vi.hoisted(() => {
  const redisInstances: Array<{
    set: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  const mockRedis = vi.fn(function () {
    const instance = {
      set: vi.fn(),
      eval: vi.fn(),
      on: vi.fn(),
      disconnect: vi.fn(),
    };
    redisInstances.push(instance);
    return instance;
  });

  return { mockRedis, redisInstances };
});

vi.mock('ioredis', () => ({ Redis: mockRedis }));

vi.mock('@tracearr/shared', () => ({
  getRedisPrefix: vi.fn(() => ''),
}));

import { startLeaderLease, stopLeaderLease } from '../leaderLease.js';

describe('leader lease producer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    redisInstances.length = 0;
  });

  afterEach(async () => {
    await stopLeaderLease();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts producers only after acquiring the lease and stops them when it is lost', async () => {
    const onAcquired = vi.fn().mockResolvedValue(undefined);
    const onLost = vi.fn().mockResolvedValue(undefined);

    mockRedis.mockImplementationOnce(function () {
      const instance = {
        set: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('OK'),
        eval: vi.fn().mockResolvedValue(0),
        on: vi.fn(),
        disconnect: vi.fn(),
      };
      redisInstances.push(instance);
      return instance;
    });

    await startLeaderLease('redis://test', { onAcquired, onLost });

    expect(onAcquired).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onAcquired).toHaveBeenCalledOnce();
    expect(onLost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledOnce();
  });
});
