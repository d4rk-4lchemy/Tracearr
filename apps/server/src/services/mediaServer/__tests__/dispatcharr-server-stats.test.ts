import { describe, expect, it } from 'vitest';
import {
  parseDispatcharrBandwidthStatsMessage,
  parseDispatcharrPluginInfoMessage,
  parseDispatcharrServerStatsMessage,
} from '../dispatcharr/realtime.js';

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

describe('parseDispatcharrPluginInfoMessage', () => {
  const info = {
    type: 'update',
    data: {
      type: 'tracearr_plugin_info',
      schemaVersion: 1,
      pluginId: 'tracearr-sse-metrics',
      name: 'Tracearr SSE Metrics',
      version: '1.2.0',
    },
  };

  it('accepts the plugin identity contract', () => {
    expect(parseDispatcharrPluginInfoMessage(JSON.stringify(info))).toEqual({
      pluginId: info.data.pluginId,
      name: info.data.name,
      version: info.data.version,
    });
  });

  it.each([
    ['wrong envelope type', { ...info, type: 'snapshot' }],
    ['wrong schema version', { ...info, data: { ...info.data, schemaVersion: 2 } }],
    ['wrong plugin id', { ...info, data: { ...info.data, pluginId: 'other-plugin' } }],
    ['missing version', { ...info, data: { ...info.data, version: '' } }],
    ['missing name', { ...info, data: { ...info.data, name: '' } }],
  ])('rejects %s', (_name, message) => {
    expect(parseDispatcharrPluginInfoMessage(message)).toBeNull();
  });
});

describe('parseDispatcharrBandwidthStatsMessage', () => {
  const bandwidth = {
    type: 'update',
    data: {
      type: 'tracearr_bandwidth_stats',
      schemaVersion: 1,
      at: 1780000000,
      timespan: 6,
      lanBytes: 0,
      wanBytes: 0,
    },
  };

  it('accepts zero-valued samples so idle Dispatcharr servers still chart', () => {
    expect(parseDispatcharrBandwidthStatsMessage(JSON.stringify(bandwidth))).toEqual({
      at: 1780000000,
      timespan: 6,
      lanBytes: 0,
      wanBytes: 0,
    });
  });

  it.each([
    ['wrong type', { ...bandwidth, data: { ...bandwidth.data, type: 'tracearr_server_stats' } }],
    ['wrong schema version', { ...bandwidth, data: { ...bandwidth.data, schemaVersion: 2 } }],
    ['missing LAN bytes', { ...bandwidth, data: { ...bandwidth.data, lanBytes: undefined } }],
    ['negative WAN bytes', { ...bandwidth, data: { ...bandwidth.data, wanBytes: -1 } }],
    ['zero timespan', { ...bandwidth, data: { ...bandwidth.data, timespan: 0 } }],
    ['non-finite timestamp', { ...bandwidth, data: { ...bandwidth.data, at: Infinity } }],
  ])('rejects %s', (_name, message) => {
    expect(parseDispatcharrBandwidthStatsMessage(message)).toBeNull();
  });
});
