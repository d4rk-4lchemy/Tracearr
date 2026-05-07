import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatcharrRealtimeConnector } from '../dispatcharr/realtime.js';
import { DispatcharrClient } from '../dispatcharr/client.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((this: MockWebSocket, ev: unknown) => void) | null = null;
  onmessage: ((this: MockWebSocket, ev: { data?: unknown }) => void) | null = null;
  onclose: ((this: MockWebSocket, ev: unknown) => void) | null = null;
  onerror: ((this: MockWebSocket, ev: unknown) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.onclose?.call(this, {});
  }
}

function nextSnapshot(connector: DispatcharrRealtimeConnector): Promise<{ sessions: unknown[] }> {
  return new Promise((resolve) => {
    connector.once('snapshot:update', (payload) => resolve(payload as { sessions: unknown[] }));
  });
}

describe('DispatcharrRealtimeConnector', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
  });

  it('merges interleaved channel_stats and vod_stats snapshots', async () => {
    vi.spyOn(DispatcharrClient.prototype, 'getWebSocketToken').mockResolvedValue('jwt-token');
    vi.spyOn(DispatcharrClient.prototype, 'getStatusSnapshot').mockResolvedValue([{ channel_id: 'channel-1' }]);
    vi.spyOn(DispatcharrClient.prototype, 'getVodStatsSnapshot').mockResolvedValue({
      vod_connections: [],
    });
    vi.spyOn(DispatcharrClient.prototype, 'getUserMap').mockResolvedValue(
      new Map([['7', { id: '7', username: 'User Seven', isAdmin: false }]])
    );
    vi.spyOn(DispatcharrClient.prototype, 'buildNormalizedChannelsFromStatus').mockResolvedValue([
      {
        channelId: 'channel-1',
        channelName: 'Channel 1',
        clients: [{ client_id: 'live-client', user_id: '7', ip_address: '203.0.113.10' }],
      },
    ]);
    vi.spyOn(DispatcharrClient.prototype, 'getLogoPathByChannelId').mockResolvedValue(new Map());
    vi.spyOn(DispatcharrClient.prototype, 'getCurrentProgramByChannelId').mockResolvedValue(new Map());
    vi.spyOn(DispatcharrClient.prototype, 'buildSessionsFromNormalizedChannels').mockReturnValue([
      {
        sessionKey: 'channel-1:live-client',
        mediaId: 'channel-1',
        user: { id: '7', username: 'User Seven' },
        media: { title: 'Channel 1', type: 'live', durationMs: 0 },
        playback: { state: 'playing', positionMs: 0, progressPercent: 0 },
        player: { name: 'Player', deviceId: 'live-client', platform: 'Dispatcharr' },
        network: { ipAddress: '203.0.113.10', isLocal: false },
        quality: {
          bitrate: 0,
          isTranscode: false,
          videoDecision: 'directplay',
          audioDecision: 'directplay',
        },
      },
    ]);

    const connector = new DispatcharrRealtimeConnector({
      serverId: 'server-1',
      serverName: 'Dispatcharr',
      url: 'http://dispatcharr.local',
      token: 'a.b.c',
    });

    await connector.connect();
    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error('WebSocket was not created');
    ws.onopen?.call(ws, {});

    const liveSnapshotPromise = nextSnapshot(connector);
    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        data: {
          type: 'channel_stats',
          stats: JSON.stringify({ channels: [{ channel_id: 'channel-1', clients: [] }] }),
        },
      }),
    });
    const liveSnapshot = await liveSnapshotPromise;
    expect(liveSnapshot.sessions).toHaveLength(1);

    const snapshotPromise = nextSnapshot(connector);
    ws.onmessage?.call(ws, {
      data: JSON.stringify({
        data: {
          type: 'vod_stats',
          stats: JSON.stringify({
            vod_connections: [
              {
                content_type: 'movie',
                content_name: 'Movie A',
                content_uuid: 'movie-1',
                content_metadata: { duration_secs: 5000 },
                connections: [{ client_id: 'vod_1', user_id: '7', client_ip: '198.51.100.20' }],
              },
            ],
          }),
        },
      }),
    });

    const snapshot = await snapshotPromise;
    expect(snapshot.sessions).toHaveLength(2);
  });

  it('bootstraps merged live and vod sessions from REST', async () => {
    vi.spyOn(DispatcharrClient.prototype, 'getWebSocketToken').mockResolvedValue('jwt-token');
    vi.spyOn(DispatcharrClient.prototype, 'getStatusSnapshot').mockResolvedValue([{ channel_id: 'channel-1' }]);
    vi.spyOn(DispatcharrClient.prototype, 'getVodStatsSnapshot').mockResolvedValue({
      vod_connections: [
        {
          content_type: 'movie',
          content_name: 'Bootstrap Movie',
          content_uuid: 'movie-bootstrap',
          content_metadata: { duration_secs: 3000 },
          connections: [{ client_id: 'vod_boot', user_id: '7', client_ip: '198.51.100.21' }],
        },
      ],
    });
    vi.spyOn(DispatcharrClient.prototype, 'getUserMap').mockResolvedValue(
      new Map([['7', { id: '7', username: 'User Seven', isAdmin: false }]])
    );
    vi.spyOn(DispatcharrClient.prototype, 'buildNormalizedChannelsFromStatus').mockResolvedValue([
      { channelId: 'channel-1', channelName: 'Channel 1', clients: [{ client_id: 'live-1', user_id: '7' }] },
    ]);
    vi.spyOn(DispatcharrClient.prototype, 'getLogoPathByChannelId').mockResolvedValue(new Map());
    vi.spyOn(DispatcharrClient.prototype, 'getCurrentProgramByChannelId').mockResolvedValue(new Map());
    vi.spyOn(DispatcharrClient.prototype, 'buildSessionsFromNormalizedChannels').mockReturnValue([
      {
        sessionKey: 'channel-1:live-1',
        mediaId: 'channel-1',
        user: { id: '7', username: 'User Seven' },
        media: { title: 'Channel 1', type: 'live', durationMs: 0 },
        playback: { state: 'playing', positionMs: 0, progressPercent: 0 },
        player: { name: 'Player', deviceId: 'live-1', platform: 'Dispatcharr' },
        network: { ipAddress: '0.0.0.0', isLocal: false },
        quality: {
          bitrate: 0,
          isTranscode: false,
          videoDecision: 'directplay',
          audioDecision: 'directplay',
        },
      },
    ]);

    const connector = new DispatcharrRealtimeConnector({
      serverId: 'server-1',
      serverName: 'Dispatcharr',
      url: 'http://dispatcharr.local',
      token: 'a.b.c',
    });

    await connector.connect();
    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error('WebSocket was not created');

    const snapshotPromise = nextSnapshot(connector);
    ws.onopen?.call(ws, {});
    const snapshot = await snapshotPromise;

    expect(snapshot.sessions).toHaveLength(2);
  });
});
