import { describe, it, expect } from 'vitest';
import {
  isAnonymousDispatcharrUserName,
  normalizeDispatcharrChannel,
  normalizeDispatcharrUserName,
  parseRealtimeChannelStatsPayload,
  parseSessionsFromChannels,
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

    it('parses both array and paginated users responses', () => {
      expect(
        parseUsersResponse([{ id: 1, first_name: 'Ada', last_name: 'Lovelace' }])
      ).toHaveLength(1);
      expect(
        parseUsersResponse({ results: [{ id: 2, first_name: 'Grace', last_name: 'Hopper' }] })
      ).toHaveLength(1);
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
          sourceVideoDetails: { framerate: '50', bitrate: 4500 },
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
      expect(sessions[0]?.quality.sourceVideoDetails?.bitrate).toBe(3200);
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
  });
});
