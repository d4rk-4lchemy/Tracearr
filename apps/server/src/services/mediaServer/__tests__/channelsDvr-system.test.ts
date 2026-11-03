import { describe, expect, it } from 'vitest';
import { parseSystemStats } from '../channelsDvr/system.js';

const cpu = (n: number) => Array.from({ length: n }, (_, i) => ({ cpu: i, cores: 1 }));

describe('parseSystemStats', () => {
  it('maps load, memory and process memory from a /system document', () => {
    const sample = parseSystemStats(
      {
        cpu: cpu(12),
        load: { load1: 0.2, load5: 0.23, load15: 0.26 },
        memory: { total: 16224890880, available: 12363751424, usedPercent: 19.0853677778325 },
        process: { memory: 198328320, memoryPercent: 1.22237074792579, pid: 7 },
      },
      1000
    );
    expect(sample).toEqual({
      at: 1000,
      hostCpuUtilization: 1.7,
      processCpuUtilization: null,
      hostMemoryUtilization: 19.1,
      processMemoryUtilization: 1.2,
    });
  });

  it('caps load-based CPU at 100 and needs a core count', () => {
    expect(
      parseSystemStats({ cpu: cpu(4), load: { load1: 9 }, memory: { usedPercent: 50 } })
        ?.hostCpuUtilization
    ).toBe(100);
    expect(
      parseSystemStats({ load: { load1: 1 }, memory: { usedPercent: 50 } })?.hostCpuUtilization
    ).toBeNull();
  });

  it('falls back to available/total when usedPercent is missing', () => {
    expect(
      parseSystemStats({ memory: { total: 1000, available: 250 } })?.hostMemoryUtilization
    ).toBe(75);
  });

  it('returns null for pages and documents without memory figures', () => {
    expect(parseSystemStats(null)).toBeNull();
    expect(parseSystemStats('<!doctype html>')).toBeNull();
    expect(parseSystemStats([])).toBeNull();
    expect(parseSystemStats({ cpu: cpu(2), load: { load1: 1 } })).toBeNull();
  });
});
