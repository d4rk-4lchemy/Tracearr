import { describe, it, expect } from 'vitest';
import {
  attachDispatcharrChannelArtwork,
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

  it('uses the file preview as artwork for recordings and the guide logo route for live streams', () => {
    const sessions = parseSessionsFromDvr(
      dvr({
        '6-file-4880-10.0.0.90':
          'Watching recording Beat Bobby Flay S26E02 The Dynamic Duo 2020-08-23-1900.mpg from 10.0.0.90.',
        '6-stream-M3U-mlbradiofeeds-1429-10.100.12.98': 'Watching ch1429 MLBTV.WSH from iPad.',
      })
    );
    expect(sessions[0]!.media.thumbPath).toBe('/dvr/files/4880/preview.jpg');
    expect(sessions[1]!.media.thumbPath).toBe('/dvr/guide/channels/1429/logo');
  });

  it('parses virtual-channel episode metadata and strips the activity time from the client name', () => {
    const [session] = parseSessionsFromDvr(
      dvr({
        '6-file-378-192.168.30.9':
          'Watching Home Improvement - Season 6, Episode 24 from iPad at 0s',
      })
    );

    expect(session?.media.type).toBe('episode');
    expect(session?.episode).toEqual({ showTitle: 'Home Improvement', seasonNumber: 6, episodeNumber: 24 });
    expect(session?.user.username).toBe('iPad');
    expect(session?.player.name).toBe('iPad');
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

  it('parses cellular HLS activity with an opaque key and transcoder status', () => {
    const [session] = parseSessionsFromDvr(
      dvr({
        '7-ch17-dANY-1050cb66a9c4':
          "Watching ch17 from Joe's iPhone (Transcoder Running at 2mbps: 1m36s @ 1.06x (66.79fps)): buf=0% drop=0%",
      })
    );
    expect(session?.media.type).toBe('live');
    expect(session?.live?.channelIdentifier).toBe('17');
    expect(session?.player.name).toBe("Joe's iPhone");
    expect(session?.network.ipAddress).toBe('0.0.0.0');
    expect(session?.sessionKey).toBe('7-ch17-dANY-1050cb66a9c4');
  });

  it('removes empty or populated transient transcoder parentheses from cellular client names', () => {
    const empty = parseWatchActivity({
      key: '7-ch17-dANY-empty',
      text: "Watching ch17 from Joe's iPhone (): buf=0% drop=0%",
    });
    const transcoding = parseWatchActivity({
      key: '7-ch17-dANY-transcoding',
      text: "Watching ch17 from Joe's iPhone (Transcoder Running at 2mbps: 1m36s @ 1.06x (66.79fps)): buf=0% drop=0%",
    });
    const starting = parseWatchActivity({
      key: '7-ch17-dANY-starting',
      text: "Watching ch17 from Joe's iPhone (Transcoder starting at 2mbps): buf=0% drop=0%",
    });

    expect(empty?.clientName).toBe("Joe's iPhone");
    expect(transcoding?.clientName).toBe("Joe's iPhone");
    expect(starting?.clientName).toBe("Joe's iPhone");
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


  it('matches artwork independently when Channels DVR users watch different channels', () => {
    const sessions = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-DispatcharrHLS-210-192.168.30.8':
          'Watching ch210 NFL Game Pass 11 from Living Room Apple TV',
        '6-stream-M3U-DispatcharrHLS-220-192.168.30.9':
          'Watching ch220 ESPN from Bedroom Apple TV',
      })
    );

    const matched = attachDispatcharrChannelArtwork(sessions, 'http://192.168.30.241:8089', [
      {
        serverId: '11111111-1111-4111-8111-111111111111',
        ipAddress: '192.168.30.241',
        channelTitle: 'NFL Game Pass 11',
        channelThumb: '/api/channels/logos/210/cache/',
      },
      {
        serverId: '11111111-1111-4111-8111-111111111111',
        ipAddress: '192.168.30.241',
        channelTitle: 'ESPN',
        channelThumb: '/api/channels/logos/220/cache/',
      },
    ]);

    expect(matched[0]!.live?.channelThumb).toBe(
      'dispatcharr://11111111-1111-4111-8111-111111111111/api/channels/logos/210/cache/'
    );
    expect(matched[1]!.live?.channelThumb).toBe(
      'dispatcharr://11111111-1111-4111-8111-111111111111/api/channels/logos/220/cache/'
    );
    // The viewer IPs remain the Channels DVR clients, not the DVR server.
    expect(matched[0]!.network.ipAddress).toBe('192.168.30.8');
    expect(matched[1]!.network.ipAddress).toBe('192.168.30.9');
  });

  it('strips the Dispatcharr server origin from absolute channel logo URLs', () => {
    const sessions = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-DispatcharrHLS-210-192.168.30.8':
          'Watching ch210 NFL Game Pass 11 from Living Room Apple TV',
      })
    );

    const matched = attachDispatcharrChannelArtwork(sessions, 'http://192.168.30.241:8089', [
      {
        serverId: 'd24c475b-1469-496a-9eb4-b5385f20dd86',
        ipAddress: '192.168.30.241',
        channelTitle: 'NFL Game Pass 11',
        channelThumb: 'http://192.168.30.241:9191/api/channels/logos/245/cache/',
      },
    ]);

    expect(matched[0]!.live?.channelThumb).toBe(
      'dispatcharr://d24c475b-1469-496a-9eb4-b5385f20dd86/api/channels/logos/245/cache/'
    );
  });

  it('does not match artwork from a Dispatcharr session on a different server IP', () => {
    const sessions = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-DispatcharrHLS-210-192.168.30.8':
          'Watching ch210 NFL Game Pass 11 from Living Room Apple TV',
      })
    );

    const matched = attachDispatcharrChannelArtwork(sessions, 'http://192.168.30.241:8089', [
      {
        serverId: '11111111-1111-4111-8111-111111111111',
        ipAddress: '192.168.30.242',
        channelTitle: 'NFL Game Pass 11',
        channelThumb: '/api/channels/logos/210/cache/',
      },
    ]);

    expect(matched[0]!.live?.channelThumb).toBeUndefined();
  });

  it('leaves artwork unchanged when matching Dispatcharr sessions conflict', () => {
    const sessions = parseSessionsFromDvr(
      dvr({
        '6-stream-M3U-DispatcharrHLS-210-192.168.30.8':
          'Watching ch210 NFL Game Pass 11 from Living Room Apple TV',
      })
    );

    const matched = attachDispatcharrChannelArtwork(sessions, 'http://192.168.30.241:8089', [
      {
        serverId: '11111111-1111-4111-8111-111111111111',
        ipAddress: '192.168.30.241',
        channelTitle: 'NFL Game Pass 11',
        channelThumb: '/api/channels/logos/210/cache/',
      },
      {
        serverId: '22222222-2222-4222-8222-222222222222',
        ipAddress: '192.168.30.241',
        channelTitle: 'NFL Game Pass 11',
        channelThumb: '/api/channels/logos/210/cache/',
      },
    ]);

    expect(matched[0]!.live?.channelThumb).toBeUndefined();
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
