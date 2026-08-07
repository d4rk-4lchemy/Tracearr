import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../../../../utils/http.js';
import {
  clearLiveTvEpgServer,
  enrichLiveTvSessions,
  registerLiveTvEpgPollTrigger,
} from '../liveTvEpg.js';

vi.mock('../../../../utils/http.js', () => ({ fetchJson: vi.fn() }));

const mockFetchJson = vi.mocked(fetchJson);
const now = Date.parse('2026-08-06T12:00:00.000Z');

function nowPlayingName(value: unknown): unknown {
  return (value as { NowPlayingItem?: { Name?: unknown } }).NowPlayingItem?.Name;
}

function nowPlayingId(value: unknown): unknown {
  return (value as { NowPlayingItem?: { Id?: unknown } }).NowPlayingItem?.Id;
}

function session(id: string) {
  return {
    Id: id,
    NowPlayingItem: {
      Id: 'channel-1',
      Type: 'LiveTvChannel',
      Name: 'News 24',
      ChannelName: 'News 24',
      ChannelId: 'channel-1',
    },
  };
}

describe('Live TV EPG cache', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
    clearLiveTvEpgServer('server-1');
    registerLiveTvEpgPollTrigger(() => undefined);
  });

  it('fetches one guide response for multiple sessions on the same channel', async () => {
    mockFetchJson.mockResolvedValue({
      Items: [
        {
          ChannelId: 'channel-1',
          Name: 'The Current Programme',
          StartDate: '2026-08-06T11:30:00.000Z',
          EndDate: '2026-08-06T12:30:00.000Z',
        },
      ],
    });

    const firstResult = await enrichLiveTvSessions(
      'server-1',
      'http://jellyfin.local',
      { Authorization: 'token' },
      [session('one'), session('two')],
      'jellyfin',
      now
    );

    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(firstResult).toHaveLength(2);
    expect(nowPlayingName(firstResult[0])).toBe('News 24');
    await vi.waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
    const result = await enrichLiveTvSessions(
      'server-1',
      'http://jellyfin.local',
      { Authorization: 'token' },
      [session('one'), session('two')],
      'jellyfin',
      now
    );
    expect(nowPlayingName(result[0])).toBe('The Current Programme');
    expect(nowPlayingId(result[1])).toBe('channel-1');
  });

  it('keeps the session unchanged when the guide is unavailable', async () => {
    mockFetchJson.mockRejectedValue(new Error('403'));
    const original = session('one');

    const result = await enrichLiveTvSessions(
      'server-1',
      'http://emby.local',
      { 'X-Emby-Authorization': 'token' },
      [original],
      'emby',
      now
    );

    expect(result).toEqual([original]);
  });

  it('restores channel identity and metadata when /Sessions only exposes a programme item', async () => {
    mockFetchJson.mockResolvedValue({
      Items: [
        {
          ChannelId: 'real-channel-1',
          ChannelNumber: '12',
          Name: 'Świat według Kiepskich',
          StartDate: '2026-08-06T11:30:00.000Z',
          EndDate: '2026-08-06T12:30:00.000Z',
        },
      ],
    });
    const raw = {
      Id: 'programme-item-1',
      NowPlayingItem: {
        Id: 'programme-item-1',
        ChannelId: 'real-channel-1',
        Type: 'LiveTvChannel',
        Name: 'Mocny Full TV',
      },
    };

    await enrichLiveTvSessions(
      'server-1',
      'http://jellyfin.local',
      { Authorization: 'token' },
      [raw],
      'jellyfin',
      now
    );
    await vi.waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(1));
    const result = await enrichLiveTvSessions(
      'server-1',
      'http://jellyfin.local',
      { Authorization: 'token' },
      [raw],
      'jellyfin',
      now
    );
    const item = (result[0] as { NowPlayingItem: Record<string, unknown> }).NowPlayingItem;

    expect(item.Id).toBe('programme-item-1');
    expect(item.ChannelId).toBe('real-channel-1');
    expect(item.ChannelName).toBe('Mocny Full TV');
    expect(item.ChannelNumber).toBe('12');
    expect(item.Name).toBe('Świat według Kiepskich');
  });
});
