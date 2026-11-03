import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../../utils/http.js';
import { ChannelsDvrClient } from '../channelsDvr/client.js';

const BASE = 'http://channels.local:8089';
const client = () => new ChannelsDvrClient({ url: BASE, token: 'none' });

describe('Channels DVR session artwork', () => {
  beforeEach(() => vi.mocked(fetchJson).mockReset());


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
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('uses DVR file airing metadata for virtual-channel episode playback', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-378-192.168.30.9':
            'Watching Home Improvement - Season 6, Episode 24 from iPad at 0s',
        },
      } as never)
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
    expect(session?.media.title).toBe('Taps - S06E24');
    expect(session?.episode).toEqual({ showTitle: 'Home Improvement', seasonNumber: 6, episodeNumber: 24 });
    expect(session?.media.durationMs).toBe(1353897);
    expect(session?.media.thumbPath).toBe('/tmsimg/assets/p7895187_b_h9_aa.jpg?w=720&h=540');
    expect(session?.player.name).toBe('iPad');
    expect(session?.user.username).toBe('iPad');
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('uses the parent show poster for episode playback', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-4880-10.0.0.90':
            'Watching recording Beat Bobby Flay S26E02 The Dynamic Duo 2020-08-23-1900.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce({ show_id: '183983', image_url: 'https://tmsimg.fancybits.co/assets/episode.jpg' } as never)
      .mockResolvedValueOnce({ image_url: 'https://tmsimg.fancybits.co/assets/show.jpg?w=720&h=540' } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/show.jpg?w=720&h=540');
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('uses movie poster art instead of the preview frame', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-5157-10.0.0.90':
            'Watching recording Indiana Jones and the Last Crusade 2021-09-02-0019.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce({ image_url: 'https://tmsimg.fancybits.co/assets/movie.jpg?w=480&h=720' } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/movie.jpg?w=480&h=720');
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('uses imported video artwork when the item is not classified as a movie', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-file-7777-10.0.0.90':
            'Watching recording Imported video 2022-01-01-1200.mpg from 10.0.0.90.',
        },
      } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({
        image_url: 'https://tmsimg.fancybits.co/assets/imported-video.jpg',
      } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/imported-video.jpg');
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });
});

