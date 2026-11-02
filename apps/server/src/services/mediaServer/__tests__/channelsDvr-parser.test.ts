import { describe, it, expect } from 'vitest';
import {
  parseSessionsFromDvr,
  parseDvrActivity,
  parseWatchActivity,
} from '../channelsDvr/parser.js';

// Shapes taken from public Channels community posts; the format is undocumented.
const dvr = (activity: Record<string, unknown>) => ({ activity, busy: true });

describe('Channels DVR parser', () => {
  it('maps a recording playback to an episode session', () => {
    const [s] = parseSessionsFromDvr(
      dvr({
        '6-file-4880-10.0.0.90':
          'Watching recording Beat Bobby Flay S26E02 The Dynamic Duo 2020-08-23-1900.mpg from 10.0.0.90.',
      })
    );
    expect(s).toBeDefined();
    expect(s!.media.type).toBe('episode');
    expect(s!.episode).toMatchObject({
      showTitle: 'Beat Bobby Flay',
      seasonNumber: 26,
      episodeNumber: 2,
    });
    expect(s!.media.title).toBe('The Dynamic Duo');
    expect(s!.network).toEqual({ ipAddress: '10.0.0.90', isLocal: true });
    expect(s!.user.id).toBe('10.0.0.90');
    expect(s!.mediaId).toBe('4880');
  });

  it('maps a live stream and uses the client name as the user when present', () => {
    const [s] = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-mlbradiofeeds-1429-10.100.12.98': 'Watching ch1429 MLBTV.WSH on iPad',
      })
    );
    expect(s!.media.type).toBe('live');
    expect(s!.live?.channelIdentifier).toBe('1429');
    expect(s!.live?.channelTitle).toBe('MLBTV.WSH');
    expect(s!.user.username).toBe('iPad');
    expect(s!.network.ipAddress).toBe('10.100.12.98');
  });

  it('parses a real Dispatcharr-sourced live line with a stats tail', () => {
    const [s] = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-DispatcharrHLS-210-192.168.30.8':
          'Watching ch210 NFL Game Pass 11: Kansas City Chiefs vs Denver Broncos @ Nov 01 04:25 PM ET from Living Room Apple TV: buf=0% drop=0% timeouts=0 segment_timeouts=0 playlist_timeouts=0',
      })
    );
    expect(s!.user.username).toBe('Living Room Apple TV');
    expect(s!.player.name).toBe('Living Room Apple TV');
    expect(s!.network.ipAddress).toBe('192.168.30.8');
    expect(s!.live).toEqual({ channelTitle: 'NFL Game Pass 11', channelIdentifier: '210' });
    expect(s!.media.title).toBe('Kansas City Chiefs vs Denver Broncos @ Nov 01 04:25 PM ET');
    expect(s!.sessionKey).toBe('6-stream-M3U-DispatcharrHLS-210-192.168.30.8');
  });

  it('ignores non-viewing activity and malformed input', () => {
    expect(
      parseSessionsFromDvr(
        dvr({
          '3-processor': 'Processing newly recorded files.',
          '1-rec-abc': 'Recording NBC Nightly News',
          bad: 42,
        })
      )
    ).toEqual([]);
    expect(parseDvrActivity(null)).toEqual([]);
    expect(parseDvrActivity({ activity: [] })).toEqual([]);
    expect(parseWatchActivity({ key: 'k', text: 'Watching' })).toBeNull();
  });

  it('classifies public IPs as non-local', () => {
    const [s] = parseSessionsFromDvr(
      dvr({ '6-file-1-8.8.8.8': 'Watching recording A Movie 2020-01-01-2000.mpg from 8.8.8.8.' })
    );
    expect(s!.network.isLocal).toBe(false);
    expect(s!.media.type).toBe('movie');
  });
});
