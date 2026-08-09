import { describe, expect, it } from 'vitest';
import { parseDispatcharrServerStatsMessage } from '../dispatcharr/realtime.js';

const valid = {
  type: 'update',
  data: {
    type: 'tracearr_server_stats',
    schemaVersion: 1,
    at: 1780000000000,
    hostCpuUtilization: null,
    processCpuUtilization: 12.34,
    hostMemoryUtilization: null,
    processMemoryUtilization: 42.1,
  },
};

describe('parseDispatcharrServerStatsMessage', () => {
  it('accepts the plugin contract', () => {
    expect(parseDispatcharrServerStatsMessage(JSON.stringify(valid))).toEqual({
      at: valid.data.at,
      hostCpuUtilization: null,
      processCpuUtilization: 12.34,
      hostMemoryUtilization: null,
      processMemoryUtilization: 42.1,
    });
  });

  it.each([
    ['invalid JSON', '{'],
    ['wrong type', JSON.stringify({ ...valid, type: 'snapshot' })],
    ['wrong version', JSON.stringify({ ...valid, data: { ...valid.data, schemaVersion: 2 } })],
    [
      'missing field',
      JSON.stringify({ ...valid, data: { ...valid.data, processCpuUtilization: undefined } }),
    ],
    ['NaN', JSON.stringify({ ...valid, data: { ...valid.data, at: 'NaN' } })],
    [
      'out of range',
      JSON.stringify({ ...valid, data: { ...valid.data, processMemoryUtilization: 101 } }),
    ],
  ])('rejects %s', (_name, message) => {
    expect(parseDispatcharrServerStatsMessage(message)).toBeNull();
  });

  it('also accepts an already decoded WebSocket envelope', () => {
    expect(parseDispatcharrServerStatsMessage(valid)?.processCpuUtilization).toBe(12.34);
  });
});
