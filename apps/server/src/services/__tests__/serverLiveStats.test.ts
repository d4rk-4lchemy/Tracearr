import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  recordServerStatsSample,
  getPluginServerStats,
  getServerLiveStats,
} from '../serverLiveStats.js';

const serverId = 'srv-1';

function fakeRedis() {
  const multiChain = {
    lpush: vi.fn().mockReturnThis(),
    ltrim: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  const redis = {
    multi: vi.fn(() => multiChain),
    lrange: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  };
  return { redis: redis as unknown as Redis, raw: redis, multiChain };
}

const completeSample = {
  at: 1786151199,
  hostCpuUtilization: 3.257,
  processCpuUtilization: 0.622,
  hostMemoryUtilization: 30.042,
  processMemoryUtilization: 0.548,
};

describe('recordServerStatsSample', () => {
  let ctx: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    ctx = fakeRedis();
  });

  it('pushes a complete sample as a chart point with window trim and ttl', async () => {
    await recordServerStatsSample(ctx.redis, serverId, completeSample);

    const [key, payload] = ctx.multiChain.lpush.mock.calls[0] as [string, string];
    expect(key).toContain(serverId);
    expect(JSON.parse(payload)).toEqual({
      at: 1786151199,
      timespan: 6,
      hostCpuUtilization: 3.257,
      processCpuUtilization: 0.622,
      hostMemoryUtilization: 30.042,
      processMemoryUtilization: 0.548,
    });
    expect(ctx.multiChain.ltrim).toHaveBeenCalledWith(key, 0, 26);
    expect(ctx.multiChain.expire).toHaveBeenCalledWith(key, 60);
    expect(ctx.multiChain.exec).toHaveBeenCalledTimes(1);
  });

  it('keeps samples with null host metrics so non-Linux hosts still chart', async () => {
    await recordServerStatsSample(ctx.redis, serverId, {
      ...completeSample,
      hostCpuUtilization: null,
      hostMemoryUtilization: null,
    });

    const [, payload] = ctx.multiChain.lpush.mock.calls[0] as [string, string];
    expect(JSON.parse(payload)).toEqual({
      at: 1786151199,
      timespan: 6,
      hostCpuUtilization: null,
      processCpuUtilization: 0.622,
      hostMemoryUtilization: null,
      processMemoryUtilization: 0.548,
    });
  });

  it('drops samples missing process metrics', async () => {
    await recordServerStatsSample(ctx.redis, serverId, {
      ...completeSample,
      processCpuUtilization: null,
    });

    expect(ctx.raw.multi).not.toHaveBeenCalled();
  });

  it('swallows redis failures', async () => {
    ctx.multiChain.exec.mockRejectedValue(new Error('down'));

    await expect(
      recordServerStatsSample(ctx.redis, serverId, completeSample)
    ).resolves.toBeUndefined();
  });
});

describe('getPluginServerStats', () => {
  it('parses buffered points and skips malformed entries', async () => {
    const ctx = fakeRedis();
    const point = {
      at: 100,
      timespan: 6,
      hostCpuUtilization: 1,
      processCpuUtilization: 2,
      hostMemoryUtilization: 3,
      processMemoryUtilization: 4,
    };
    ctx.raw.lrange.mockResolvedValue([JSON.stringify(point), 'not-json']);

    const result = await getPluginServerStats(ctx.redis, serverId);

    expect(result).toEqual([point]);
    expect(ctx.raw.lrange.mock.calls[0]?.[0]).toContain(serverId);
  });

  it('returns empty on redis failure', async () => {
    const ctx = fakeRedis();
    ctx.raw.lrange.mockRejectedValue(new Error('down'));

    expect(await getPluginServerStats(ctx.redis, serverId)).toEqual([]);
  });
});

describe('getServerLiveStats', () => {
  it('serves plugin-buffered statistics for non-plex servers with empty bandwidth', async () => {
    const ctx = fakeRedis();
    const point = {
      at: 100,
      timespan: 6,
      hostCpuUtilization: 1,
      processCpuUtilization: 2,
      hostMemoryUtilization: 3,
      processMemoryUtilization: 4,
    };
    ctx.raw.lrange.mockResolvedValue([JSON.stringify(point)]);

    const result = await getServerLiveStats(ctx.redis, {
      id: serverId,
      type: 'jellyfin',
      url: 'http://jf.local',
      token: 'tok',
    });

    expect(result).toEqual({
      statistics: [point],
      bandwidth: [],
      bandwidthSamples: [],
      bandwidthAccounts: [],
      bandwidthDevices: [],
    });
    expect(ctx.raw.get).not.toHaveBeenCalled();
  });
});
