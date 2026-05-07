import { describe, it, expect, vi } from 'vitest';
import {
  isAnonymousDispatcharrUserName,
  normalizeDispatcharrChannel,
  normalizeDispatcharrUserName,
  parseRealtimeChannelStatsPayload,
  parseRealtimeVodStatsPayload,
  parseSessionsFromChannels,
  parseSessionsFromVodStats,
  parseStatusResponse,
  parseUser,
  parseUsersResponse,
} from '../dispatcharr/parser.js';

describe('Dispatcharr parser', () => {
  describe('user parsing', () => {
    it('maps display name from first_name and last_name', () => {
      const user = parseUser({
        id: 42,
        username: 'ignored-login',
        first_name: 'Jan',
        last_name: 'Kowalski',
        email: 'jan@example.com',
        user_level: 10,
      });

      expect(user).toMatchObject({
        id: '42',
        username: 'Jan Kowalski',
        email: 'jan@example.com',
        isAdmin: true,
      });
    });

    it('falls back to username when first and last name are empty', () => {
      expect(
        normalizeDispatcharrUserName({
          id: 2,
          username: 'local-user',
          first_name: '',
          last_name: '',
        })
      ).toBe('local-user');
    });

    it('filters Anonymous and Anonymouse users', () => {
      expect(isAnonymousDispatcharrUserName('Anonymous')).toBe(true);
      expect(isAnonymousDispatcharrUserName('Anonymouse')).toBe(true);
      expect(parseUser({ id: 1, first_name: 'Anonymous', last_name: '' })).toBeNull();
      expect(parseUser({ id: 2, first_name: 'Anonymouse', last_name: '' })).toBeNull();
    });

    it('keeps Anonymous and Anonymouse users when ignoreAnonymousStreams is disabled', () => {
      expect(
        parseUser(
          { id: 1, first_name: 'Anonymous', last_name: '', username: 'anonymous' },
          { ignoreAnonymousStreams: false }
        )
      ).toMatchObject({
        id: '1',
        username: 'Anonymous',
      });
      expect(
        parseUser(
          { id: 2, first_name: 'Anonymouse', last_name: '', username: 'anonymouse' },
          { ignoreAnonymousStreams: false }
        )
      ).toMatchObject({
        id: '2',
        username: 'Anonymouse',
      });
    });

    it('parses both array and paginated users responses', () => {
      expect(
        parseUsersResponse([{ id: 1, first_name: 'Ada', last_name: 'Lovelace' }])
      ).toHaveLength(1);
      expect(
        parseUsersResponse({ results: [{ id: 2, first_name: 'Grace', last_name: 'Hopper' }] })
      ).toHaveLength(1);
    });

    it('includes anonymous users when ignoreAnonymousStreams is disabled', () => {
      const users = parseUsersResponse(
        [
          { id: 1, first_name: 'Anonymous', last_name: '', username: 'anonymous' },
          { id: 2, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
        ],
        { ignoreAnonymousStreams: false }
      );

      expect(users).toHaveLength(2);
      expect(users.map((user) => user.username)).toEqual(['Anonymous', 'Ada Lovelace']);
    });
  });

  describe('status parsing', () => {
    it('parses websocket channel_stats payload where stats is JSON string', () => {
      const parsed = parseRealtimeChannelStatsPayload({
        data: {
          type: 'channel_stats',
          stats: JSON.stringify({
            channels: [{ channel_id: 'channel-1', clients: [] }],
            count: 1,
          }),
        },
      });

      expect(parsed).toEqual({
        channels: [{ channel_id: 'channel-1', clients: [] }],
        count: 1,
      });
    });

    it('parses status channels and maps clients to live sessions', () => {
      const status = parseStatusResponse({
        channels: [
          {
            channel_id: 'channel-1',
            channel_name: 'News HD',
            state: 'active',
            client_count: 2,
            avg_bitrate_kbps: 4500,
            source_fps: '50',
            audio_channels: 2,
            resolution: '1080p',
            clients: [
              {
                client_id: 'client-1',
                user_id: '7',
                user_agent: 'TiviMate',
                ip_address: '203.0.113.10',
              },
              {
                client_id: 'anonymous-client',
                user_id: '0',
                user_agent: 'Unknown',
                ip_address: '203.0.113.11',
              },
            ],
          },
        ],
      });
      const channels = status.flatMap((channel) => {
        const normalized = normalizeDispatcharrChannel(channel);
        return normalized ? [normalized] : [];
      });

      const userById = new Map([
        ['7', { id: '7', username: 'Valid User', isAdmin: false }],
        ['0', { id: '0', username: 'Anonymous', isAdmin: false }],
      ]);
      const sessions = parseSessionsFromChannels(channels, userById);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionKey: 'channel-1:client-1',
        mediaId: 'channel-1',
        user: { id: '7', username: 'Valid User' },
        media: { title: 'News HD', type: 'live' },
        live: { channelTitle: 'News HD', channelIdentifier: 'channel-1' },
        player: { deviceId: 'client-1', product: 'TiviMate' },
        quality: {
          bitrate: 4500,
          videoResolution: '1080p',
          sourceAudioChannels: 2,
          sourceVideoDetails: { framerate: '50' },
        },
      });
    });

    it('maps avg_bitrate fallback when avg_bitrate_kbps is missing', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'News HD',
        avg_bitrate: 3200,
        clients: [{ client_id: 'client-1', user_id: '7' }],
      });
      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.quality.bitrate).toBe(3200);
      expect(sessions[0]?.quality.sourceVideoDetails?.bitrate).toBeUndefined();
    });

    it('maps string audio_channels value "stereo" to 2 channels', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'Mocny Full TV',
        audio_channels: 'stereo',
        clients: [{ client_id: 'client-1', user_id: '7' }],
      });
      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.quality.sourceAudioChannels).toBe(2);
    });

    it('maps string audio_channels value "5.1" to 6 channels', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'Mocny Full TV',
        audio_channels: '5.1',
        clients: [{ client_id: 'client-1', user_id: '7' }],
      });
      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.quality.sourceAudioChannels).toBe(6);
    });

    it('skips sessions whose mapped user is anonymous', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        clients: [{ client_id: 'client-1', user_id: '9' }],
      });
      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['9', { id: '9', username: 'Anonymouse', isAdmin: false }]])
      );

      expect(sessions).toHaveLength(0);
    });

    it('includes anonymous sessions when ignoreAnonymousStreams is disabled', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'News HD',
        clients: [
          { client_id: 'named-anonymous', user_id: '9', user_agent: 'Browser' },
          { client_id: 'zero-user', user_id: '0', user_agent: 'Browser' },
        ],
      });

      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['9', { id: '9', username: 'Anonymouse', isAdmin: false }]]),
        undefined,
        { ignoreAnonymousStreams: false }
      );

      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.user.username).toBe('Anonymouse');
      expect(sessions[1]?.user).toMatchObject({
        id: '0',
        username: 'Anonymous',
      });
    });

    it('uses channel_name from base status over stream_name from detail', () => {
      const normalized = normalizeDispatcharrChannel(
        {
          channel_id: 'channel-1',
          channel_name: 'BBC News',
        },
        {
          channel_id: 'channel-1',
          stream_name: 'generic-stream-title',
          clients: [{ client_id: 'client-1', user_id: '7' }],
        }
      );

      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.media.title).toBe('BBC News');
      expect(sessions[0]?.live?.channelTitle).toBe('BBC News');
    });

    it('uses currentProgramTitle as media title for live sessions', () => {
      const normalized = normalizeDispatcharrChannel(
        { channel_id: 'channel-1', channel_name: 'BBC News' },
        { channel_id: 'channel-1', clients: [{ client_id: 'client-1', user_id: '7' }] }
      );
      if (!normalized) throw new Error('Expected normalized channel');
      normalized.currentProgramTitle = 'Top Stories';

      const sessions = parseSessionsFromChannels(
        [normalized],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.media.title).toBe('Top Stories');
      expect(sessions[0]?.live?.channelTitle).toBe('BBC News');
    });

    it('normalizes WxH resolution to quality label and preserves dimensions', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'BBC News',
        resolution: '1920x1080',
        clients: [{ client_id: 'client-1', user_id: '7' }],
      });

      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.quality.videoResolution).toBe('1080p');
      expect(sessions[0]?.quality.videoWidth).toBe(1920);
      expect(sessions[0]?.quality.videoHeight).toBe(1080);
    });

    it('maps connected_at (float) to elapsed playback position', () => {
      const nowMs = 1_778_150_600_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

      try {
        const normalized = normalizeDispatcharrChannel({
          channel_id: 'channel-1',
          channel_name: 'BBC News',
          clients: [
            { client_id: 'client-1', user_id: '7', connected_at: 1_778_150_550.3093927 },
          ],
        });

        const sessions = parseSessionsFromChannels(
          normalized ? [normalized] : [],
          new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
        );

        expect(sessions[0]?.playback.positionMs).toBe(49_691);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('maps connected_at string to elapsed playback position', () => {
      const nowMs = 1_000_000_000_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

      try {
        const normalized = normalizeDispatcharrChannel({
          channel_id: 'channel-1',
          channel_name: 'BBC News',
          clients: [{ client_id: 'client-1', user_id: '7', connected_at: '999999995.5' }],
        });

        const sessions = parseSessionsFromChannels(
          normalized ? [normalized] : [],
          new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
        );

        expect(sessions[0]?.playback.positionMs).toBe(4_500);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('falls back to 0 playback position when connected_at is missing', () => {
      const normalized = normalizeDispatcharrChannel({
        channel_id: 'channel-1',
        channel_name: 'BBC News',
        clients: [{ client_id: 'client-1', user_id: '7' }],
      });

      const sessions = parseSessionsFromChannels(
        normalized ? [normalized] : [],
        new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
      );

      expect(sessions[0]?.playback.positionMs).toBe(0);
    });

    it('clamps playback position to 0 when connected_at is in the future', () => {
      const nowMs = 1_000_000_000_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

      try {
        const normalized = normalizeDispatcharrChannel({
          channel_id: 'channel-1',
          channel_name: 'BBC News',
          clients: [{ client_id: 'client-1', user_id: '7', connected_at: 1_000_000_100 }],
        });

        const sessions = parseSessionsFromChannels(
          normalized ? [normalized] : [],
          new Map([['7', { id: '7', username: 'Valid User', isAdmin: false }]])
        );

        expect(sessions[0]?.playback.positionMs).toBe(0);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('parses websocket vod_stats payload where stats is JSON string', () => {
      const parsed = parseRealtimeVodStatsPayload({
        data: {
          type: 'vod_stats',
          stats: JSON.stringify({
            vod_connections: [
              {
                content_type: 'movie',
                content_name: 'Movie A',
                connections: [{ client_id: 'vod_1', user_id: '7', content_uuid: 'movie-1' }],
              },
            ],
          }),
        },
      });

      expect(parsed).toMatchObject({
        vod_connections: [
          {
            content_type: 'movie',
            content_name: 'Movie A',
          },
        ],
      });
    });

    it('maps movie and episode sessions from vod_stats', () => {
      const sessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'The Movie',
              content_uuid: 'movie-uuid',
              content_metadata: { year: 2021, duration_secs: 5400, logo_url: '/logos/m1.png' },
              connections: [
                {
                  client_id: 'vod_123',
                  user_id: '7',
                  client_ip: '203.0.113.20',
                  user_agent: 'VLC',
                  position_seconds: 1200,
                },
              ],
            },
            {
              content_type: 'episode',
              content_name: 'Fallback Episode Name',
              content_uuid: 'episode-uuid',
              content_metadata: {
                episode_name: 'Pilot',
                series_name: 'Great Show',
                season_number: 1,
                episode_number: 2,
                duration_secs: 1800,
                logo_url: '/logos/s1.png',
                series_year: 2020,
              },
              connections: [
                {
                  client_id: 'vod_124',
                  user_id: '8',
                  client_ip: '10.0.0.2',
                  user_agent: 'Kodi',
                  position_seconds: 600,
                },
              ],
            },
          ],
        },
        new Map([
          ['7', { id: '7', username: 'Movie User', isAdmin: false }],
          ['8', { id: '8', username: 'Episode User', isAdmin: false }],
        ])
      );

      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({
        sessionKey: 'vod_123',
        mediaId: 'movie-uuid',
        media: { type: 'movie', title: 'The Movie', durationMs: 5_400_000, year: 2021, thumbPath: '/logos/m1.png' },
        playback: { positionMs: 1_200_000, state: 'playing' },
        quality: { bitrate: 0, isTranscode: false, videoDecision: 'directplay', audioDecision: 'directplay' },
      });
      expect(sessions[1]).toMatchObject({
        sessionKey: 'vod_124',
        mediaId: 'episode-uuid',
        media: { type: 'episode', title: 'Pilot', durationMs: 1_800_000, year: 2020 },
        episode: { showTitle: 'Great Show', seasonNumber: 1, episodeNumber: 2, showThumbPath: '/logos/s1.png' },
        network: { ipAddress: '10.0.0.2', isLocal: true },
      });
    });

    it('filters vod sessions when user is unknown', () => {
      const sessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'Movie',
              content_uuid: 'movie-uuid',
              connections: [{ client_id: 'vod_1', user_id: '999' }],
            },
          ],
        },
        new Map([['7', { id: '7', username: 'Known User', isAdmin: false }]])
      );

      expect(sessions).toHaveLength(0);
    });

    it('falls back to last_known_position when position_seconds is zero', () => {
      const sessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'episode',
              content_name: 'Episode',
              content_uuid: 'ep-1',
              content_metadata: { duration_secs: 3600, episode_name: 'Episode 1', series_name: 'Show' },
              connections: [
                {
                  client_id: 'vod_last_known',
                  user_id: '7',
                  position_seconds: 0,
                  last_known_position: 3000,
                },
              ],
            },
          ],
        },
        new Map([['7', { id: '7', username: 'Known User', isAdmin: false }]])
      );

      expect(sessions[0]?.playback.positionMs).toBe(3_000_000);
      expect(sessions[0]?.playback.progressPercent).toBe(83);
    });

    it('falls back to seek byte ratio when position fields are unavailable', () => {
      const sessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'Movie',
              content_uuid: 'movie-1',
              content_metadata: { duration_secs: 6000 },
              connections: [
                {
                  client_id: 'vod_seek_bytes',
                  user_id: '7',
                  position_seconds: 0,
                  last_known_position: 0,
                  last_seek_byte: 1_740_000_000,
                  total_content_size: 3_480_000_000,
                },
              ],
            },
          ],
        },
        new Map([['7', { id: '7', username: 'Known User', isAdmin: false }]])
      );

      expect(sessions[0]?.playback.positionMs).toBe(3_000_000);
      expect(sessions[0]?.playback.progressPercent).toBe(50);
    });

    it('falls back to seek percentage and handles both 0..100 and 0..1 scales', () => {
      const percentSessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'Movie',
              content_uuid: 'movie-1',
              content_metadata: { duration_secs: 4000 },
              connections: [
                {
                  client_id: 'vod_seek_percent_100',
                  user_id: '7',
                  position_seconds: 0,
                  last_seek_percentage: 25,
                },
                {
                  client_id: 'vod_seek_percent_ratio',
                  user_id: '7',
                  position_seconds: 0,
                  last_seek_percentage: 0.5,
                },
              ],
            },
          ],
        },
        new Map([['7', { id: '7', username: 'Known User', isAdmin: false }]])
      );

      expect(percentSessions[0]?.playback.positionMs).toBe(1_000_000);
      expect(percentSessions[1]?.playback.positionMs).toBe(2_000_000);
    });

    it('falls back to connection duration and clamps position to media duration', () => {
      const sessions = parseSessionsFromVodStats(
        {
          vod_connections: [
            {
              content_type: 'movie',
              content_name: 'Movie',
              content_uuid: 'movie-1',
              content_metadata: { duration_secs: 6000 },
              connections: [
                {
                  client_id: 'vod_duration_fallback',
                  user_id: '7',
                  position_seconds: 0,
                  last_known_position: 0,
                  duration: 7000,
                },
              ],
            },
          ],
        },
        new Map([['7', { id: '7', username: 'Known User', isAdmin: false }]])
      );

      expect(sessions[0]?.playback.positionMs).toBe(6_000_000);
      expect(sessions[0]?.playback.progressPercent).toBe(100);
    });
  });
});
