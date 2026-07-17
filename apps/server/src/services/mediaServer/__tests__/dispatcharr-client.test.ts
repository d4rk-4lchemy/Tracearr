import { afterEach, describe, expect, it, vi } from 'vitest';
import { DispatcharrClient } from '../dispatcharr/client.js';

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  (DispatcharrClient as unknown as { credentialCache: Map<string, unknown> }).credentialCache.clear();
  (DispatcharrClient as unknown as { outputProfileCache: Map<string, unknown> }).outputProfileCache.clear();
});

describe('DispatcharrClient', () => {
  it('fetches users, expands channel details, resolves logos+epg, and filters anonymous sessions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-API-Key']).toBe('api-key');

      if (url.endsWith('/api/accounts/users/')) {
        return jsonResponse([
          { id: 7, first_name: 'Valid', last_name: 'User', username: 'valid' },
          { id: 8, first_name: 'Anonymous', last_name: '', username: 'anonymous' },
        ]);
      }
      if (url.endsWith('/proxy/ts/status')) {
        return jsonResponse({
          channels: [
            { channel_id: 'channel-1', channel_name: 'News 24', client_count: 2 },
            { channel_id: 'channel-2', client_count: 1 },
          ],
        });
      }
      if (url.endsWith('/proxy/vod/stats/')) {
        return jsonResponse({
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'VOD Movie',
              content_uuid: 'movie-1',
              content_metadata: { duration_secs: 7200, year: 2022, logo_url: '/logos/movie-1.png' },
              connections: [
                {
                  client_id: 'vod_1',
                  user_id: '7',
                  client_ip: '203.0.113.50',
                  user_agent: 'VLC',
                  position_seconds: 50,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith('/proxy/ts/status/channel-1')) {
        return jsonResponse({
          channel_id: 'channel-1',
          stream_name: 'Stream Name Should Not Win',
          clients: [
            { client_id: 'client-1', user_id: '7', ip_address: '198.51.100.10' },
            { client_id: 'anon-client', user_id: '8', ip_address: '198.51.100.11' },
          ],
        });
      }
      if (url.endsWith('/proxy/ts/status/channel-2')) {
        return jsonResponse({
          channel_id: 'channel-2',
          channel_name: 'Channel Two',
          clients: [{ client_id: 'anonymous-zero', user_id: '0' }],
        });
      }
      if (url.endsWith('/api/channels/channels/by-uuids/')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ uuids: ['channel-1', 'channel-2'] }));
        return jsonResponse([{ uuid: 'channel-1', logo_id: 'logo-123' }]);
      }
      if (url.endsWith('/api/epg/current-programs/')) {
        expect(init?.method).toBe('POST');
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['Content-Type']).toBe('application/json');
        expect(init?.body).toBe(
          JSON.stringify({ channel_uuids: ['channel-1', 'channel-2'] })
        );
        return jsonResponse([
          { channel_uuid: 'channel-1', title: 'Morning News' },
          { channel_uuid: 'channel-2', title: 'Sports Live' },
        ]);
      }

      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local/', token: 'api-key' });
    const sessions = await client.getSessions();

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.sessionKey).toBe('channel-1:client-1');
    expect(sessions[0]?.user.username).toBe('Valid User');
    expect(sessions[0]?.media.title).toBe('Morning News');
    expect(sessions[0]?.live?.channelTitle).toBe('News 24');
    expect(sessions[0]?.live?.channelThumb).toBe(
      'http://dispatcharr.local/api/channels/logos/logo-123/cache/'
    );
    expect(sessions[1]).toMatchObject({
      sessionKey: 'vod_1',
      mediaId: 'movie-1',
      media: { type: 'movie', title: 'VOD Movie', year: 2022 },
    });
  });

  it('includes anonymous sessions and users when ignoreAnonymousStreams is disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-API-Key']).toBe('api-key');

      if (url.endsWith('/api/accounts/users/')) {
        return jsonResponse([
          { id: 7, first_name: 'Valid', last_name: 'User', username: 'valid' },
          { id: 8, first_name: 'Anonymous', last_name: '', username: 'anonymous' },
        ]);
      }
      if (url.endsWith('/proxy/ts/status')) {
        return jsonResponse({
          channels: [{ channel_id: 'channel-1', channel_name: 'News 24', client_count: 3 }],
        });
      }
      if (url.endsWith('/proxy/vod/stats/')) {
        return jsonResponse({
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'Anon VOD',
              content_uuid: 'movie-2',
              content_metadata: { duration_secs: 3600 },
              connections: [{ client_id: 'vod_anon', user_id: '0', client_ip: '198.51.100.90' }],
            },
          ],
        });
      }
      if (url.endsWith('/proxy/ts/status/channel-1')) {
        return jsonResponse({
          channel_id: 'channel-1',
          clients: [
            { client_id: 'client-1', user_id: '7', ip_address: '198.51.100.10' },
            { client_id: 'anon-client', user_id: '8', ip_address: '198.51.100.11' },
            { client_id: 'anon-zero', user_id: '0', ip_address: '198.51.100.12' },
          ],
        });
      }
      if (url.endsWith('/api/channels/channels/by-uuids/')) {
        return jsonResponse([{ uuid: 'channel-1', logo_id: 'logo-123' }]);
      }
      if (url.endsWith('/api/epg/current-programs/')) {
        return jsonResponse([{ channel_uuid: 'channel-1', title: 'Morning News' }]);
      }

      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const client = new DispatcharrClient({
      url: 'http://dispatcharr.local/',
      token: 'api-key',
      ignoreAnonymousStreams: false,
    });

    const [users, sessions] = await Promise.all([client.getUsers(), client.getSessions()]);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(users.map((user) => user.username)).toEqual(['Valid User', 'Anonymous']);
    expect(sessions).toHaveLength(4);
    expect(sessions.map((session) => session.user.username)).toEqual([
      'Valid User',
      'Anonymous',
      'Anonymous',
      'Anonymous',
    ]);
  });

  it('fetches output profiles for v0.25.x profile-backed sessions and maps output details', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-API-Key']).toBe('api-key');

      if (url.endsWith('/api/accounts/users/')) {
        return jsonResponse([{ id: 7, first_name: 'Valid', last_name: 'User', username: 'valid' }]);
      }
      if (url.endsWith('/proxy/ts/status')) {
        return jsonResponse({
          channels: [{ channel_id: 'channel-1', channel_name: 'News 24', client_count: 1 }],
        });
      }
      if (url.endsWith('/proxy/vod/stats/')) {
        return jsonResponse({ vod_connections: [] });
      }
      if (url.endsWith('/proxy/ts/status/channel-1')) {
        return jsonResponse({
          channel_id: 'channel-1',
          channel_name: 'News 24',
          ffmpeg_speed: 0.94,
          video_codec: 'H264',
          audio_codec: 'AC3',
          clients: [
            {
              client_id: 'client-1',
              user_id: '7',
              ip_address: '198.51.100.10',
              output_format: 'mpegts',
              output_profile_id: 5,
            },
          ],
        });
      }
      if (url.endsWith('/api/core/outputprofiles/')) {
        return jsonResponse([
          {
            id: 5,
            name: 'Web Player',
            command: 'ffmpeg',
            parameters: '-i pipe:0 -c:v copy -c:a aac -b:a 192k -ac 2 -f mpegts pipe:1',
            is_active: true,
          },
        ]);
      }
      if (url.endsWith('/api/channels/channels/by-uuids/')) {
        return jsonResponse([{ uuid: 'channel-1', logo_id: 'logo-123' }]);
      }
      if (url.endsWith('/api/epg/current-programs/')) {
        return jsonResponse([{ channel_uuid: 'channel-1', title: 'Morning News' }]);
      }

      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local/', token: 'api-key' });
    const sessions = await client.getSessions();

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.quality).toMatchObject({
      isTranscode: true,
      videoDecision: 'directplay',
      audioDecision: 'transcode',
      streamAudioCodec: 'AAC',
      streamAudioDetails: { bitrate: 192, channels: 2 },
    });
    expect(sessions[0]?.quality.transcodeInfo).toMatchObject({
      sourceContainer: 'MPEGTS',
      streamContainer: 'MPEGTS',
      reasons: ['Dispatcharr output profile: Web Player'],
    });
    expect(sessions[0]?.quality.transcodeInfo?.speed).toBeUndefined();
  });

  it('does not fetch output profiles when sessions do not use output_profile_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-API-Key']).toBe('api-key');

      if (url.endsWith('/api/accounts/users/')) {
        return jsonResponse([{ id: 7, first_name: 'Valid', last_name: 'User', username: 'valid' }]);
      }
      if (url.endsWith('/proxy/ts/status')) {
        return jsonResponse({
          channels: [{ channel_id: 'channel-1', channel_name: 'News 24', client_count: 1 }],
        });
      }
      if (url.endsWith('/proxy/vod/stats/')) {
        return jsonResponse({ vod_connections: [] });
      }
      if (url.endsWith('/proxy/ts/status/channel-1')) {
        return jsonResponse({
          channel_id: 'channel-1',
          channel_name: 'News 24',
          ffmpeg_speed: 1.04,
          clients: [{ client_id: 'client-1', user_id: '7', ip_address: '198.51.100.10' }],
        });
      }
      if (url.endsWith('/api/channels/channels/by-uuids/')) {
        return jsonResponse([{ uuid: 'channel-1', logo_id: 'logo-123' }]);
      }
      if (url.endsWith('/api/epg/current-programs/')) {
        return jsonResponse([{ channel_uuid: 'channel-1', title: 'Morning News' }]);
      }
      if (url.endsWith('/api/core/outputprofiles/')) {
        throw new Error('output profiles endpoint should not be called');
      }

      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local/', token: 'api-key' });
    const sessions = await client.getSessions();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(sessions[0]?.quality.transcodeInfo?.speed).toBe(1.04);
  });

  it('returns live sessions when vod stats fetch fails', async () => {
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local/', token: 'api-key' });
    const liveSessions = [
      {
        sessionKey: 'channel-1:client-1',
        userId: '7',
        user: { id: '7', username: 'Valid User' },
        mediaId: 'channel-1',
        media: { type: 'episode', title: 'Morning News' },
      },
    ];

    vi.spyOn(client, 'getStatusSnapshot').mockResolvedValue([{ channel_id: 'channel-1' }]);
    vi.spyOn(client, 'getVodStatsSnapshot').mockRejectedValue(new Error('vod unavailable'));
    vi.spyOn(client, 'getUserMap').mockResolvedValue(new Map());
    vi.spyOn(client, 'buildSessionsFromStatusSnapshot').mockResolvedValue(liveSessions as never);
    const buildVodSpy = vi.spyOn(client, 'buildSessionsFromVodStatsSnapshot');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(client.getSessions()).resolves.toEqual(liveSessions);
    expect(buildVodSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to fetch Dispatcharr VOD stats from http://dispatcharr.local; continuing with live sessions only',
      expect.any(Error)
    );
  });

  it('uses bearer auth for JWT-like tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer a.b.c');
      return jsonResponse([]);
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'a.b.c' });
    await client.getUsers();
  });

  it('authenticates with username/password credential token and then uses JWT bearer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/accounts/token/')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({
          access:
            'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQ3NDA3MTY4MDB9.signature',
          refresh: 'refresh-token',
        });
      }
      if (url.endsWith('/api/accounts/users/')) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.Authorization).toBe(
          'Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQ3NDA3MTY4MDB9.signature'
        );
        return jsonResponse([]);
      }
      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const token = DispatcharrClient.encodeCredentialToken('admin', 'secret');
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token });
    await client.getUsers();
  });

  it('terminates live sessions using ts stop_client endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true }));
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'api-key' });

    await expect(client.terminateSession('channel-1:client-1')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dispatcharr.local/proxy/ts/stop_client/channel-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: 'client-1' }),
      })
    );
  });

  it('terminates vod sessions using vod stop_client endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true }));
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'api-key' });

    await expect(client.terminateSession('vod_123')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dispatcharr.local/proxy/vod/stop_client/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: 'vod_123' }),
      })
    );
  });
});
