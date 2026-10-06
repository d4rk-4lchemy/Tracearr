import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaSession } from '../types.js';
import { DispatcharrClient } from '../dispatcharr/client.js';
import { DispatcharrRealtimeConnector } from '../dispatcharr/realtime.js';
import {
  normalizeDispatcharrChannel,
  type DispatcharrChannelStatus,
} from '../dispatcharr/parser.js';
import { mapMediaSession, pickLiveSessionFields } from '../../../jobs/poller/sessionMapper.js';

const providerState = DispatcharrClient as unknown as {
  m3uProviderCache: Map<string, unknown>;
  m3uProviderRequestsInFlight: Map<string, Promise<boolean>>;
};
const connectors: DispatcharrRealtimeConnector[] = [];

afterEach(async () => {
  for (const connector of connectors.splice(0)) connector.disconnect();
  await finishRefresh();
  providerState.m3uProviderCache.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function finishRefresh() {
  await Promise.all(providerState.m3uProviderRequestsInFlight.values());
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function newClient(token = 'api-key', url = 'http://dispatcharr.local') {
  return new DispatcharrClient({ id: 'server-1', name: 'Dispatcharr', url, token });
}

function channel(profileId: number | null = 1): DispatcharrChannelStatus {
  return {
    channel_id: 'channel-1',
    channel_name: 'News',
    m3u_profile_id: profileId,
    stream_id: profileId,
    clients: [{ client_id: 'client-1', user_id: '7', user_agent: 'VLC' }],
  };
}

function normalized(raw = channel()) {
  const result = normalizeDispatcharrChannel(raw);
  if (!result) throw new Error('Invalid test channel');
  return result;
}

const users = new Map([['7', { id: '7', username: 'Viewer', isAdmin: false }]]);

describe('Dispatcharr M3U providers', () => {
  it.each(['api-key', 'jwt', 'credentials'] as const)(
    'uses the existing %s authentication for account lookup',
    async (mode) => {
      const token =
        mode === 'credentials'
          ? DispatcharrClient.encodeCredentialToken('viewer', 'password')
          : mode === 'jwt'
            ? 'a.b.c'
            : 'api-key';
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (String(input).endsWith('/api/accounts/token/')) return json({ access: 'd.e.f' });
        expect(String(input)).toBe('http://dispatcharr.local/api/m3u/accounts/');
        expect(init?.headers).toMatchObject(
          mode === 'api-key'
            ? { 'X-API-Key': 'api-key' }
            : { Authorization: `Bearer ${mode === 'jwt' ? 'a.b.c' : 'd.e.f'}` }
        );
        return json([{ name: 'Provider A', profiles: [{ id: 1 }] }]);
      });
      const client = newClient(token);
      const channels = [normalized()];
      client.enrichLiveProviderNames(channels);
      await finishRefresh();
      client.enrichLiveProviderNames(channels);
      expect(channels[0]?.m3uProviderName).toBe('Provider A');
      expect(fetchMock).toHaveBeenCalledTimes(mode === 'credentials' ? 2 : 1);
    }
  );

  it('resolves default and custom profiles to the account name and carries it without speed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json([
        {
          name: ' Provider A ',
          profiles: [
            { id: 1, name: 'Provider A Default' },
            { id: 2, name: 'Output 1080p' },
          ],
        },
      ])
    );
    const client = newClient();
    const channels = await client.buildNormalizedChannelsFromStatus([channel(1)], [channel(1)]);
    expect(channels[0]?.m3uProviderName).toBeUndefined();
    await finishRefresh();
    const enriched = await client.buildNormalizedChannelsFromStatus(
      [channel(1), { ...channel(2), channel_id: 'channel-2' }],
      [channel(1), { ...channel(2), channel_id: 'channel-2' }]
    );
    const sessions = client.buildSessionsFromNormalizedChannels(enriched, users);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.quality.transcodeInfo).toEqual({ dispatcharrProviderName: 'Provider A' });
      expect(session.quality.isTranscode).toBe(false);
      const processed = mapMediaSession(session, 'dispatcharr');
      expect(pickLiveSessionFields(processed).transcodeInfo).toEqual({
        dispatcharrProviderName: 'Provider A',
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps channel speed and output-profile decisions independent of the provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json([{ name: 'Provider A', profiles: [{ id: 1 }] }])
    );
    const client = newClient();
    const raw = {
      ...channel(),
      ffmpeg_speed: '2.54',
      clients: [{ client_id: 'client-1', user_id: '7', output_profile_id: 99 }],
    };
    await client.buildNormalizedChannelsFromStatus([raw], [raw]);
    await finishRefresh();
    const channels = await client.buildNormalizedChannelsFromStatus([raw], [raw]);
    expect(client.buildSessionsFromNormalizedChannels(channels, users)[0]?.quality).toMatchObject({
      isTranscode: true,
      transcodeInfo: {
        speed: 2.54,
        dispatcharrProviderName: 'Provider A',
        reasons: ['Dispatcharr output profile active'],
      },
    });
  });

  it('does not delay discovery for a pending request, shares it and calls refresh once per observer', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    const client = newClient();
    const observer = vi.fn();
    const channels = await client.buildNormalizedChannelsFromStatus([channel()], [channel()]);
    client.enrichLiveProviderNames(channels, observer);
    client.enrichLiveProviderNames(channels, observer);
    await newClient().buildNormalizedChannelsFromStatus([channel()], [channel()]);
    expect(client.buildSessionsFromNormalizedChannels(channels, users)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(json([{ name: 'Provider A', profiles: [{ id: 1 }] }]));
    await finishRefresh();
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('handles paginated accounts under BASE_PATH without caching other account fields', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        json({
          results: [{ name: 'A', profiles: [{ id: 1 }], server_url: 'secret' }],
          next: '?page=2',
        })
      )
      .mockResolvedValueOnce(json({ results: [{ name: 'B', profiles: [{ id: 2 }] }], next: null }));
    const client = newClient('api-key', 'http://dispatcharr.local/base');
    const channels = [normalized(channel(2))];
    client.enrichLiveProviderNames(channels);
    await finishRefresh();
    client.enrichLiveProviderNames(channels);
    expect(channels[0]?.m3uProviderName).toBe('B');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://dispatcharr.local/base/api/m3u/accounts/',
      'http://dispatcharr.local/base/api/m3u/accounts/?page=2',
    ]);
    expect(JSON.stringify([...providerState.m3uProviderCache])).not.toContain('secret');
  });

  it.each(['http://other.local/api/m3u/accounts/?page=2', '/api/accounts/users/', '?page=1'])(
    'rejects unsafe or cyclic pagination: %s',
    async (next) => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(json({ results: [], next }));
      const client = newClient();
      const channels = [normalized()];
      client.enrichLiveProviderNames(channels);
      await finishRefresh();
      client.enrichLiveProviderNames(channels);
      expect(channels[0]?.m3uProviderName).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(next === '?page=1' ? 2 : 1);
    }
  );

  it('isolates names by credentials and server and refreshes them after 60 seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json([{ name: 'A', profiles: [{ id: 1 }] }]))
      .mockResolvedValueOnce(json([{ name: 'B', profiles: [{ id: 1 }] }]))
      .mockResolvedValueOnce(json([{ name: 'C', profiles: [{ id: 1 }] }]))
      .mockResolvedValueOnce(json([{ name: 'Renamed A', profiles: [{ id: 1 }] }]));
    const clients = [
      newClient('key-a'),
      newClient('key-b'),
      newClient('key-a', 'http://second.local'),
    ];
    const cases = clients.map((client) => ({ client, channels: [normalized()] }));
    for (const { client, channels } of cases) {
      client.enrichLiveProviderNames(channels);
      await finishRefresh();
      client.enrichLiveProviderNames(channels);
    }
    expect(cases.map(({ channels }) => channels[0]?.m3uProviderName)).toEqual(['A', 'B', 'C']);
    const first = cases[0];
    if (!first) throw new Error('Missing test client');
    now.mockReturnValue(160_001);
    first.client.enrichLiveProviderNames(first.channels);
    await finishRefresh();
    first.client.enrichLiveProviderNames(first.channels);
    expect(first.channels[0]?.m3uProviderName).toBe('Renamed A');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps sessions on API errors, backs off and does not invent a provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 403));
    const client = newClient();
    const channels = await client.buildNormalizedChannelsFromStatus([channel()], [channel()]);
    await finishRefresh();
    client.enrichLiveProviderNames(channels);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      client.buildSessionsFromNormalizedChannels(channels, users)[0]?.quality.transcodeInfo
    ).toBeUndefined();
    client.enrichLiveProviderNames([normalized(channel(null))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the current profile ID and rejects stale details after a stream switch or profile removal', () => {
    expect(normalizeDispatcharrChannel(channel(2), channel(1))?.m3uProfileId).toBe(2);
    expect(normalizeDispatcharrChannel(channel(null), channel(1))?.m3uProfileId).toBeUndefined();
    expect(
      normalizeDispatcharrChannel({ channel_id: 'channel-1', stream_id: 2 }, channel(1))
        ?.m3uProfileId
    ).toBeUndefined();
    expect(
      normalizeDispatcharrChannel({ channel_id: 'channel-1', stream_id: 1 }, channel(1))
        ?.m3uProfileId
    ).toBe(1);
  });
});

class ProviderWebSocket {
  static instance: ProviderWebSocket;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    ProviderWebSocket.instance = this;
  }
  close() {}
}

describe('Dispatcharr realtime provider enrichment', () => {
  it.each(['enrich', 'switch', 'stop', 'disconnect'] as const)(
    'handles %s while the account lookup is pending without restoring stale sessions',
    async (action) => {
      vi.stubGlobal('WebSocket', ProviderWebSocket);
      vi.spyOn(DispatcharrClient.prototype, 'getWebSocketToken').mockResolvedValue('jwt');
      vi.spyOn(DispatcharrClient.prototype, 'getStatusSnapshot').mockResolvedValue([channel()]);
      vi.spyOn(DispatcharrClient.prototype, 'getVodStatsSnapshot').mockResolvedValue({
        vod_connections: [],
      });
      vi.spyOn(DispatcharrClient.prototype, 'getCatchupStatsSnapshot').mockResolvedValue({
        timeshift_sessions: [],
      });
      vi.spyOn(DispatcharrClient.prototype, 'getUserMap').mockResolvedValue(users);
      vi.spyOn(DispatcharrClient.prototype, 'getLogoPathByChannelId').mockResolvedValue(new Map());
      vi.spyOn(DispatcharrClient.prototype, 'getCurrentProgramByChannelId').mockResolvedValue(
        new Map()
      );
      vi.spyOn(DispatcharrClient.prototype, 'getChannelStatus').mockResolvedValue({
        ...channel(),
        avg_bitrate_kbps: 1000,
        video_codec: 'h264',
        resolution: '1920x1080',
      });
      let resolveResponse!: (response: Response) => void;
      vi.spyOn(globalThis, 'fetch').mockReturnValue(
        new Promise((resolve) => {
          resolveResponse = resolve;
        })
      );
      const connector = new DispatcharrRealtimeConnector({
        serverId: 'server-1',
        serverName: 'Dispatcharr',
        url: 'http://dispatcharr.local',
        token: 'a.b.c',
      });
      connectors.push(connector);
      const snapshots: MediaSession[][] = [];
      connector.on('snapshot:update', (snapshot: { sessions: MediaSession[] }) =>
        snapshots.push(snapshot.sessions)
      );
      await connector.connect();
      ProviderWebSocket.instance.onopen?.();
      await vi.waitFor(() => expect(snapshots.at(-1)).toHaveLength(1));
      expect(snapshots.at(-1)?.[0]?.quality.transcodeInfo?.dispatcharrProviderName).toBeUndefined();
      if (action === 'disconnect') connector.disconnect();
      else if (action !== 'enrich') {
        ProviderWebSocket.instance.onmessage?.({
          data: JSON.stringify({
            data: {
              type: 'channel_stats',
              stats: { channels: action === 'stop' ? [] : [channel(2)] },
            },
          }),
        });
        await vi.waitFor(() => {
          expect(snapshots.at(-1)).toHaveLength(action === 'stop' ? 0 : 1);
          if (action === 'switch') expect(snapshots.length).toBeGreaterThan(1);
        });
      }
      const count = snapshots.length;
      resolveResponse(
        json([
          { name: 'A', profiles: [{ id: 1 }] },
          { name: 'B', profiles: [{ id: 2 }] },
        ])
      );
      await finishRefresh();
      if (action === 'switch' || action === 'enrich') {
        await vi.waitFor(() =>
          expect(snapshots.at(-1)?.[0]?.quality.transcodeInfo?.dispatcharrProviderName).toBe(
            action === 'switch' ? 'B' : 'A'
          )
        );
        expect(snapshots.at(-1)?.[0]?.sessionKey).toBe('channel-1:client-1');
      } else {
        // Drain the connector queue after its background callback.
        await (connector as unknown as { updateQueue: Promise<void> }).updateQueue;
        expect(snapshots).toHaveLength(count);
      }
    }
  );
});
