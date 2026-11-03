import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson, fetchText } from '../../../utils/http.js';
import { ChannelsDvrClient } from '../channelsDvr/client.js';

const BASE = 'http://channels.local:8089';
const client = () => new ChannelsDvrClient({ url: BASE, token: 'none' });

describe('Channels DVR session artwork', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset();
    vi.mocked(fetchText).mockReset().mockResolvedValue('');
  });


  it('returns virtual-channel sessions when guide artwork is delayed', async () => {
    let resolveGuide!: (value: unknown) => void;
    const guideRequest = new Promise((resolve) => {
      resolveGuide = resolve;
    });
    const dvrStatus = {
      activity: {
        '6-stream-M3U-MyMediaServer-123-192.168.30.9':
          'Watching ch123 My Virtual Channel from Apple TV: buf=0% drop=0%',
      },
    };

    vi.mocked(fetchJson)
      .mockResolvedValueOnce(dvrStatus as never)
      .mockResolvedValueOnce([] as never)
      .mockImplementationOnce(() => guideRequest as never)
      .mockResolvedValueOnce(dvrStatus as never);

    const channelsClient = client();

    // This must resolve even though the guide request is still pending.
    const [firstSession] = await channelsClient.getSessions();
    expect(firstSession?.media.type).toBe('live');
    expect(firstSession?.live?.channelTitle).toBe('My Virtual Channel');
    expect(firstSession?.media.thumbPath).not.toContain('p31385280_b_h9_aa.jpg');

    resolveGuide([
      {
        Channel: { Number: '123', Name: 'My Virtual Channel' },
        Airings: [
          {
            Time: Math.floor(Date.now() / 1000) - 60,
            Duration: 3600,
            Title: 'My Media Server Program',
            Image: 'https://ebyl.tmsimg.com/assets/p31385280_b_h9_aa.jpg',
          },
        ],
      },
    ]);
    await guideRequest;

    // The next poll can use the completed guide refresh without another request.
    const [nextSession] = await channelsClient.getSessions();
    expect(nextSession?.media.thumbPath).toBe('/tmsimg/assets/p31385280_b_h9_aa.jpg');
    expect(nextSession?.media.title).toBe('My Media Server Program');
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('uses registered Channels DVR client metadata for the matching playback device', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-378-192.168.30.9':
            'Watching Home Improvement - Season 6, Episode 24 from iPad at 0s',
        },
      } as never)
      .mockResolvedValueOnce([
        {
          id: 'b7bfc53adc025d77',
          machine_id: '9F5A5EE9-EE9D-5DE7-A841-C2DF1CD42F31',
          hostname: 'iPad',
          device: 'iPad8,6',
          platform: 'iPadOS 27.2',
          app_bundle: 'com.getchannels.dvr.beta',
          app_build: '10.29.54',
          local_ip: '192.168.30.9',
          connected: true,
        },
      ] as never);

    const [session] = await client().getSessions();

    expect(session?.player).toMatchObject({
      name: 'iPad',
      deviceId: '9F5A5EE9-EE9D-5DE7-A841-C2DF1CD42F31',
      device: 'iPad8,6',
      platform: 'iPadOS 27.2',
      product: 'Channels Beta v10.29.54',
    });
    expect(session?.network.ipAddress).toBe('192.168.30.9');
  });

  it('uses DVR file airing metadata for virtual-channel episode playback', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-378-192.168.30.9':
            'Watching Home Improvement - Season 6, Episode 24 from iPad at 0s',
        },
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({
        Duration: 1353.897,
        Airing: {
          Title: 'Home Improvement',
          EpisodeTitle: 'Taps',
          SeasonNumber: 6,
          EpisodeNumber: 24,
          Image: 'https://tmsimg.fancybits.co/assets/p7895187_b_h9_aa.jpg?w=720&h=540',
        },
      } as never);

    const [session] = await client().getSessions();

    expect(session?.media.type).toBe('episode');
    expect(session?.media.title).toBe('Taps');
    expect(session?.episode).toEqual({ showTitle: 'Home Improvement', seasonNumber: 6, episodeNumber: 24 });
    expect(session?.media.durationMs).toBe(1353897);
    expect(session?.media.thumbPath).toBe('/tmsimg/assets/p7895187_b_h9_aa.jpg?w=720&h=540');
    expect(session?.player.name).toBe('iPad');
    expect(session?.user.username).toBe('iPad');
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('uses the parent show poster for episode playback', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-4880-10.0.0.90':
            'Watching recording Beat Bobby Flay S26E02 The Dynamic Duo 2020-08-23-1900.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({ show_id: '183983', image_url: 'https://tmsimg.fancybits.co/assets/episode.jpg' } as never)
      .mockResolvedValueOnce({ image_url: 'https://tmsimg.fancybits.co/assets/show.jpg?w=720&h=540' } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/show.jpg?w=720&h=540');
    expect(fetchJson).toHaveBeenCalledTimes(5);
  });

  it('uses movie poster art instead of the preview frame', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-5157-10.0.0.90':
            'Watching recording Indiana Jones and the Last Crusade 2021-09-02-0019.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({ image_url: 'https://tmsimg.fancybits.co/assets/movie.jpg?w=480&h=720' } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/movie.jpg?w=480&h=720');
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('uses imported video artwork when the item is not classified as a movie', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-7777-10.0.0.90':
            'Watching recording Imported video 2022-01-01-1200.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({
        image_url: 'https://tmsimg.fancybits.co/assets/imported-video.jpg',
      } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/imported-video.jpg');
    expect(fetchJson).toHaveBeenCalledTimes(5);
  });

  it('maps Channels DVR HLS probe and encoder logs to live stream details without an upstream tuner dependency', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-stream-M3U-AnyTuner-1-192.168.30.9':
            'Watching ch1 ABC KOCO from iPad: buf=0% drop=0%',
        },
      } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    vi.mocked(fetchText).mockResolvedValueOnce([
      '2026/11/03 12:00:38.672772 [HLS] Starting live stream for channel 1 from 192.168.30.9',
      '2026/11/03 12:00:39.936010 [HLS] Session ch1-dANY-ip192.168.30.9 started in 1.263s',
      '2026/11/03 12:00:40.096451 [HLS] Probed live stream in 1.423s: h264 1920x1080 progressive 8098867bps',
      '2026/11/03 12:00:40.097300 [ENC] Starting encoder for ch1 in /channels-data/Streaming/sessions/ch1-dANY-ip192.168.30.9-4215598824/encoder-1-2811138658 at 1 (0.466000) (encoder=remux, acodec=aac, bitrate=8098, segment_size=0.01)',
    ].join('\n'));

    const [session] = await client().getSessions();

    expect(session?.quality).toMatchObject({
      bitrate: 8099,
      isTranscode: false,
      videoDecision: 'copy',
      audioDecision: 'unknown',
      sourceVideoCodec: 'h264',
      videoWidth: 1920,
      videoHeight: 1080,
      sourceVideoDetails: { bitrate: 8099 },
      streamVideoCodec: 'h264',
      streamVideoDetails: { width: 1920, height: 1080, bitrate: 8098 },
      streamAudioCodec: 'aac',
    });
    expect(session?.quality.sourceAudioCodec).toBeUndefined();
    expect(fetchText).toHaveBeenCalledWith(
      `${BASE}/log?n=10000`,
      expect.objectContaining({ service: 'channels-dvr' })
    );
  });

});

