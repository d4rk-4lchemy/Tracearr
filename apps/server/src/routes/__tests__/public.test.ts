/**
 * Public API route tests
 *
 * Covers response mapping used by third-party integrations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import { createMockActiveSession } from '../../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbSelect: vi.fn(),
  getAllActiveSessions: vi.fn(),
  buildAvatarUrl: vi.fn((serverId: string | null | undefined, thumbUrl: string | null | undefined) =>
    serverId && thumbUrl ? `/avatar?server=${serverId}&url=${encodeURIComponent(thumbUrl)}` : null
  ),
  buildPosterUrl: vi.fn((serverId: string | null | undefined, thumbPath: string | null | undefined) =>
    serverId && thumbPath ? `/poster?server=${serverId}&url=${encodeURIComponent(thumbPath)}` : null
  ),
  normalizeDispatcharrImagePath: vi.fn((thumbPath: string | null | undefined) => {
    if (!thumbPath) return null;
    try {
      const parsed = new URL(thumbPath);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return thumbPath.startsWith('/') ? thumbPath : `/${thumbPath}`;
    }
  }),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    execute: (...args: unknown[]) => mocks.dbExecute(...args),
    select: (...args: unknown[]) => mocks.dbSelect(...args),
  },
}));

vi.mock('../../services/cache.js', () => ({
  getCacheService: vi.fn(() => ({
    getAllActiveSessions: mocks.getAllActiveSessions,
    getServerHealth: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../services/imageProxy.js', () => ({
  buildAvatarUrl: mocks.buildAvatarUrl,
  buildPosterUrl: mocks.buildPosterUrl,
  normalizeDispatcharrImagePath: mocks.normalizeDispatcharrImagePath,
}));

vi.mock('../../services/dashboardStats.js', () => ({
  getDashboardStats: vi.fn(),
}));

vi.mock('../../services/termination.js', () => ({
  terminateSession: vi.fn(),
}));

vi.mock('../stats/queries.js', () => ({
  queryConcurrentStreams: vi.fn(),
  queryPlatforms: vi.fn(),
  queryPlaysByDayOfWeek: vi.fn(),
  queryPlaysByHourOfDay: vi.fn(),
  queryPlaysOverTime: vi.fn(),
  queryQualityBreakdown: vi.fn(),
}));

import { publicRoutes } from '../public.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);

  app.decorate('authenticatePublicApi', async () => undefined);
  await app.register(publicRoutes, { prefix: '/public' });

  return app;
}

describe('Public API Routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllActiveSessions.mockResolvedValue([]);
    mocks.dbExecute.mockResolvedValue({ rows: [] });
    mocks.dbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /public/streams', () => {
    it('maps Dispatcharr live channel data as the primary media title and uses channel logo', async () => {
      const serverId = randomUUID();
      const session = createMockActiveSession({
        serverId,
        mediaType: 'live',
        mediaTitle: 'Evening Movie',
        grandparentTitle: null,
        thumbPath: '/fallback/program.png',
        channelTitle: 'Classic Hits TV',
        channelThumb: 'https://dispatcharr.example.com/api/channels/logos/4671/cache/',
        server: {
          id: serverId,
          name: 'Dispatcharr',
          type: 'dispatcharr',
        },
      });
      mocks.getAllActiveSessions.mockResolvedValueOnce([session]);
      app = await buildTestApp();

      const response = await app.inject({
        method: 'GET',
        url: '/public/streams',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0]).toMatchObject({
        mediaType: 'live',
        mediaTitle: 'Classic Hits TV',
        thumbPath: '/api/channels/logos/4671/cache/',
        posterUrl: `/poster?server=${serverId}&url=%2Fapi%2Fchannels%2Flogos%2F4671%2Fcache%2F`,
      });
      expect(body.data[0]).not.toHaveProperty('showTitle');
    });

    it('keeps non-live media mapping unchanged', async () => {
      const serverId = randomUUID();
      const session = createMockActiveSession({
        serverId,
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Great Show',
        thumbPath: '/Items/show/Images/Primary',
        channelTitle: 'Should Not Be Used',
        channelThumb: '/channel/logo.png',
        server: {
          id: serverId,
          name: 'Jellyfin',
          type: 'jellyfin',
        },
      });
      mocks.getAllActiveSessions.mockResolvedValueOnce([session]);
      app = await buildTestApp();

      const response = await app.inject({
        method: 'GET',
        url: '/public/streams',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0]).toMatchObject({
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        showTitle: 'Great Show',
        thumbPath: '/Items/show/Images/Primary',
      });
    });
  });

  describe('GET /public/history', () => {
    it('maps live channel fields from history rows', async () => {
      const serverId = randomUUID();
      mocks.dbExecute
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: randomUUID(),
              started_at: new Date('2026-07-06T10:00:00Z'),
              stopped_at: new Date('2026-07-06T10:30:00Z'),
              duration_ms: '1800000',
              progress_ms: 1800000,
              total_duration_ms: 0,
              segment_count: '1',
              watched: true,
              state: 'stopped',
              server_id: serverId,
              server_name: 'Dispatcharr',
              server_type: 'dispatcharr',
              media_type: 'live',
              media_title: 'Evening Movie',
              grandparent_title: null,
              season_number: null,
              episode_number: null,
              year: null,
              artist_name: null,
              album_name: null,
              track_number: null,
              disc_number: null,
              channel_title: 'Classic Hits TV',
              channel_thumb: 'https://dispatcharr.example.com/api/channels/logos/4671/cache/',
              thumb_path: '/fallback/program.png',
              device: 'Chrome',
              player_name: 'Dispatcharr Client',
              product: 'Dispatcharr Client',
              platform: 'Dispatcharr',
              is_transcode: false,
              video_decision: 'directplay',
              audio_decision: 'directplay',
              bitrate: 0,
              source_video_codec: null,
              source_audio_codec: null,
              source_audio_channels: null,
              source_video_width: null,
              source_video_height: null,
              source_video_details: null,
              source_audio_details: null,
              stream_video_codec: null,
              stream_audio_codec: null,
              stream_video_details: null,
              stream_audio_details: null,
              transcode_info: null,
              subtitle_info: null,
              user_id: randomUUID(),
              server_username: 'viewer',
              user_thumb_url: null,
              user_name: null,
              user_username: 'viewer',
            },
          ],
        });
      app = await buildTestApp();

      const response = await app.inject({
        method: 'GET',
        url: '/public/history',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0]).toMatchObject({
        mediaType: 'live',
        mediaTitle: 'Classic Hits TV',
        thumbPath: '/api/channels/logos/4671/cache/',
        posterUrl: `/poster?server=${serverId}&url=%2Fapi%2Fchannels%2Flogos%2F4671%2Fcache%2F`,
      });
      expect(body.data[0]).not.toHaveProperty('showTitle');
    });
  });
});
