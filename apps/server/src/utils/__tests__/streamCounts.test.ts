import { describe, expect, it } from 'vitest';
import { countStreams } from '../streamCounts.js';

const stream = (serverId: string, videoDecision: string, audioDecision: string) => ({
  serverId,
  server: { name: serverId },
  isTranscode: videoDecision === 'transcode' || audioDecision === 'transcode',
  videoDecision,
  audioDecision,
  bitrate: 1000,
});

describe('countStreams', () => {
  it('counts audio-only transcodes inside transcodes, overall and per server', () => {
    const { overall, byServer } = countStreams([
      stream('a', 'transcode', 'transcode'),
      stream('a', 'copy', 'transcode'),
      stream('b', 'copy', 'copy'),
      stream('b', 'directplay', 'directplay'),
    ]);

    expect(overall).toEqual({
      total: 4,
      transcodes: 2,
      audioTranscodes: 1,
      directStreams: 1,
      directPlays: 1,
      bitrateKbps: 4000,
    });
    expect(byServer.map((s) => [s.serverId, s.transcodes, s.audioTranscodes])).toEqual([
      ['a', 2, 1],
      ['b', 0, 0],
    ]);
  });
});
