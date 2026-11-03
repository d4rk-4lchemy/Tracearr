import { describe, expect, it } from 'vitest';
import { parseChannelsDvrStreamDetails } from '../channelsDvr/streamDetails.js';

describe('Channels DVR stream log parser', () => {
  it('associates probe and encoder details with the client IP and channel', () => {
    const log = [
      '2026/11/03 12:00:38.672772 [HLS] Starting live stream for channel 1 from 192.168.30.9',
      '2026/11/03 12:00:39.936010 [HLS] Session ch1-dANY-ip192.168.30.9 started in 1.263s',
      '2026/11/03 12:00:40.096451 [HLS] Probed live stream in 1.423s: h264 1920x1080 progressive 8098867bps',
      '2026/11/03 12:00:40.097300 [ENC] Starting encoder for ch1 in /channels-data/Streaming/sessions/ch1-dANY-ip192.168.30.9-4215598824/encoder-1-2811138658 at 1 (0.466000) (encoder=remux, acodec=aac, bitrate=8098, segment_size=0.01)',
    ].join('\n');

    expect(parseChannelsDvrStreamDetails(log).get('1|192.168.30.9')).toEqual({
      ipAddress: '192.168.30.9',
      channelNumber: '1',
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
      sourceBitrateKbps: 8099,
      encoder: 'remux',
      audioCodec: 'aac',
      outputBitrateKbps: 8098,
    });
  });

  it('does not carry an earlier successful probe into a later cancelled attempt', () => {
    const log = [
      '2026/11/03 12:00:38.672772 [HLS] Starting live stream for channel 1 from 192.168.30.9',
      '2026/11/03 12:00:40.096451 [HLS] Probed live stream in 1.423s: h264 1920x1080 progressive 8098867bps',
      '2026/11/03 12:01:00.000000 [HLS] Starting live stream for channel 1 from 192.168.30.9',
      '2026/11/03 12:01:03.000000 [ERR] Probe cancelled for live stream after 3s and 0 bytes',
    ].join('\n');

    const details = parseChannelsDvrStreamDetails(log).get('1|192.168.30.9');
    expect(details).toEqual({ channelNumber: '1', ipAddress: '192.168.30.9' });
    expect(details?.videoCodec).toBeUndefined();
  });

  it('keeps different clients on the same channel separate', () => {
    const log = [
      '2026/11/03 12:00:00 [HLS] Starting live stream for channel 1 from 192.168.30.9',
      '2026/11/03 12:00:01 [HLS] Probed live stream in 1s: h264 1920x1080 progressive 8000000bps',
      '2026/11/03 12:00:02 [ENC] Starting encoder for ch1 in /channels-data/Streaming/sessions/ch1-dANY-ip192.168.30.9-111/encoder-1 (0) (encoder=remux, acodec=aac, bitrate=8000)',
      '2026/11/03 12:00:03 [HLS] Starting live stream for channel 1 from 192.168.30.8',
      '2026/11/03 12:00:04 [HLS] Probed live stream in 1s: hevc 1280x720 progressive 4000000bps',
    ].join('\n');

    const details = parseChannelsDvrStreamDetails(log);
    expect(details.get('1|192.168.30.9')?.videoCodec).toBe('h264');
    expect(details.get('1|192.168.30.8')?.videoCodec).toBe('hevc');
  });
});
