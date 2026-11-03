import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../../utils/http.js';
import { ChannelsDvrClient } from '../channelsDvr/client.js';

const BASE = 'http://channels.local:8089';
const client = () => new ChannelsDvrClient({ url: BASE, token: 'none' });

describe('Channels DVR session artwork', () => {
  beforeEach(() => vi.mocked(fetchJson).mockReset());


  it('uses the current guide program artwork for live TV sessions', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        activity: {
          '6-stream-M3U-DispatcharrMPEGTS-1-192.168.30.9':
            'Watching ch1 ABC KOCO from iPad: buf=0% drop=0%',
        },
      } as never)
      .mockResolvedValueOnce([
        {
          Channel: { Number: '1', Name: 'ABC KOCO' },
          Airings: [
            {
              Time: Math.floor(Date.now() / 1000) - 60,
              Duration: 3600,
              Title: 'KOCO 5 News at 9am',
              Image: 'https://ebyl.tmsimg.com/assets/p31385280_b_h9_aa.jpg',
            },
          ],
        },
      ] as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/p31385280_b_h9_aa.jpg');
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
      .mockResolvedValueOnce({
        image_url: 'https://tmsimg.fancybits.co/assets/imported-video.jpg',
      } as never);

    const [session] = await client().getSessions();

    expect(session?.media.thumbPath).toBe('/tmsimg/assets/imported-video.jpg');
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });
});

