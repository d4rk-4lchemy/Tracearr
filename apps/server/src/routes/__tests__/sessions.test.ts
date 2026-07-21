/**
 * Session routes tests
 *
 * Tests the API endpoints for session queries:
 * - GET /sessions - List historical sessions with filters
 * - GET /sessions/active - Get currently active streams
 * - GET /sessions/:id - Get a specific session
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { SQL } from 'drizzle-orm';
import type { AuthUser } from '@tracearr/shared';
import { createMockActiveSession } from '../../test/fixtures.js';
import { renderSql } from '../../test/helpers.js';

// Mock the database module before importing routes
vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
  },
}));

// Mock cache service - need to provide getAllActiveSessions for /active endpoint
const mockGetAllActiveSessions = vi.fn().mockResolvedValue([]);
vi.mock('../../services/cache.js', () => ({
  getCacheService: vi.fn(() => ({
    getAllActiveSessions: mockGetAllActiveSessions,
    getSessionById: vi.fn().mockResolvedValue(null),
  })),
}));

// Import the mocked db and the routes
import { db } from '../../db/client.js';
import { sessionRoutes } from '../sessions.js';

/**
 * Build a test Fastify instance with mocked auth and redis
 */
async function buildTestApp(
  authUser: AuthUser,
  redisMock?: { get: ReturnType<typeof vi.fn> }
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);

  // Mock the authenticate decorator
  app.decorate('authenticate', async (request: any) => {
    request.user = authUser;
  });

  // Mock Redis (cast to never for test mock)
  app.decorate('redis', (redisMock ?? { get: vi.fn().mockResolvedValue(null) }) as never);

  await app.register(sessionRoutes, { prefix: '/sessions' });

  return app;
}

function createOwnerUser(serverIds?: string[]): AuthUser {
  return {
    userId: randomUUID(),
    username: 'owner',
    role: 'owner',
    serverIds: serverIds ?? [randomUUID()],
  };
}

function createViewerUser(serverIds?: string[]): AuthUser {
  return {
    userId: randomUUID(),
    username: 'viewer',
    role: 'viewer',
    serverIds: serverIds ?? [randomUUID()],
  };
}

describe('Session Routes', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = db as any;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /sessions', () => {
    it('should return paginated sessions for owner', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const mockSessionRows = [
        {
          id: randomUUID(),
          started_at: new Date(),
          stopped_at: new Date(),
          duration_ms: '3600000',
          paused_duration_ms: '0',
          progress_ms: 3600000,
          segment_count: '1',
          watched: true,
          state: 'stopped',
          server_id: ownerUser.serverIds[0],
          server_name: 'Test Server',
          server_type: 'plex',
          server_user_id: randomUUID(),
          username: 'testuser',
          user_thumb: null,
          session_key: 'session-1',
          media_type: 'movie',
          media_title: 'Test Movie',
          grandparent_title: null,
          season_number: null,
          episode_number: null,
          year: 2024,
          thumb_path: '/thumb',
          reference_id: null,
          ip_address: '192.168.1.1',
          geo_city: 'NYC',
          geo_region: 'NY',
          geo_country: 'US',
          geo_lat: 40.7,
          geo_lon: -74.0,
          player_name: 'Chrome',
          device_id: 'dev-1',
          product: 'Plex Web',
          device: 'Chrome',
          platform: 'Chrome',
          quality: '1080p',
          is_transcode: false,
          bitrate: 20000,
        },
      ];

      // Mock the main query
      mockDb.execute.mockResolvedValueOnce({ rows: mockSessionRows });
      // Mock the count query
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.page).toBe(1);
      expect(body.total).toBe(1);
    });

    it('should filter by serverUserId', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const serverUserId = randomUUID();
      const response = await app.inject({
        method: 'GET',
        url: `/sessions?serverUserId=${serverUserId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });

    it('should filter by mediaType', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions?mediaType=movie',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by date range', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions?startDate=2024-01-01&endDate=2024-12-31',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should handle pagination', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      mockDb.execute.mockResolvedValueOnce({ rows: [{ count: 100 }] });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions?page=2&pageSize=25',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(25);
      expect(body.totalPages).toBe(4);
    });

    it('should reject invalid query parameters', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions?page=-1',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /sessions/active', () => {
    it('should return active sessions from cache', async () => {
      const serverId = randomUUID();
      const ownerUser = createOwnerUser([serverId]);
      const activeSessions = [createMockActiveSession({ serverId })];

      // Mock the cache service response
      mockGetAllActiveSessions.mockResolvedValueOnce(activeSessions);

      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(mockGetAllActiveSessions).toHaveBeenCalled();
    });

    it('should return empty array when cache is empty', async () => {
      const ownerUser = createOwnerUser();

      // Mock empty cache
      mockGetAllActiveSessions.mockResolvedValueOnce([]);

      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });

    it('should filter sessions by user serverIds', async () => {
      const serverId1 = randomUUID();
      const serverId2 = randomUUID();
      const viewerUser = createViewerUser([serverId1]);

      const activeSessions = [
        createMockActiveSession({ serverId: serverId1 }),
        createMockActiveSession({ serverId: serverId2 }),
      ];

      // Mock the cache service response
      mockGetAllActiveSessions.mockResolvedValueOnce(activeSessions);

      app = await buildTestApp(viewerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].serverId).toBe(serverId1);
    });

    it('should handle invalid JSON in cache', async () => {
      const ownerUser = createOwnerUser();

      // getAllActiveSessions handles parsing internally, so this just tests empty
      mockGetAllActiveSessions.mockResolvedValueOnce([]);

      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /sessions/:id', () => {
    it('should return session from cache if active', async () => {
      const serverId = randomUUID();
      const sessionId = randomUUID();
      const ownerUser = createOwnerUser([serverId]);

      const activeSession = createMockActiveSession({ id: sessionId, serverId });

      const redisMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(activeSession)),
      };

      app = await buildTestApp(ownerUser, redisMock);

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(sessionId);
      expect(body.user.username).toBe(activeSession.user.username);
      expect(body.server.name).toBe(activeSession.server.name);
    });

    it('should return session from database if not in cache', async () => {
      const serverId = randomUUID();
      const sessionId = randomUUID();
      const ownerUser = createOwnerUser([serverId]);

      const redisMock = {
        get: vi.fn().mockResolvedValue(null),
      };

      app = await buildTestApp(ownerUser, redisMock);

      const dbSession = {
        id: sessionId,
        serverId,
        serverName: 'Test Server',
        serverType: 'plex',
        serverUserId: randomUUID(),
        username: 'testuser',
        userThumb: null,
        identityName: null,
        sessionKey: 'session-1',
        state: 'stopped',
        mediaType: 'movie',
        mediaTitle: 'Test Movie',
        grandparentTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        year: 2024,
        thumbPath: '/thumb',
        startedAt: new Date(),
        stoppedAt: new Date(),
        durationMs: 3600000,
        progressMs: 3600000,
        totalDurationMs: 7200000,
        lastPausedAt: null,
        pausedDurationMs: 0,
        referenceId: null,
        watched: true,
        ipAddress: '192.168.1.1',
        geoCity: 'NYC',
        geoRegion: 'NY',
        geoCountry: 'US',
        geoLat: 40.7,
        geoLon: -74.0,
        playerName: 'Chrome',
        deviceId: 'dev-1',
        product: 'Plex Web',
        device: 'Chrome',
        platform: 'Chrome',
        quality: '1080p',
        isTranscode: false,
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        bitrate: 20000,
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([dbSession]),
                }),
              }),
            }),
          }),
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(sessionId);
    });

    it('should return 404 for non-existent session', async () => {
      const ownerUser = createOwnerUser();
      const redisMock = {
        get: vi.fn().mockResolvedValue(null),
      };

      app = await buildTestApp(ownerUser, redisMock);

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 when user lacks access to session server', async () => {
      const serverId = randomUUID();
      const sessionId = randomUUID();
      const differentServerId = randomUUID();
      const viewerUser = createViewerUser([differentServerId]);

      const redisMock = {
        get: vi.fn().mockResolvedValue(null),
      };

      app = await buildTestApp(viewerUser, redisMock);

      const dbSession = {
        id: sessionId,
        serverId,
        serverName: 'Test Server',
        serverType: 'plex',
        serverUserId: randomUUID(),
        username: 'testuser',
        userThumb: null,
        identityName: null,
        sessionKey: 'session-1',
        state: 'stopped',
        mediaType: 'movie',
        mediaTitle: 'Test Movie',
        grandparentTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        year: 2024,
        thumbPath: '/thumb',
        startedAt: new Date(),
        stoppedAt: new Date(),
        durationMs: 3600000,
        progressMs: 3600000,
        totalDurationMs: 7200000,
        lastPausedAt: null,
        pausedDurationMs: 0,
        referenceId: null,
        watched: true,
        ipAddress: '192.168.1.1',
        geoCity: 'NYC',
        geoRegion: 'NY',
        geoCountry: 'US',
        geoLat: 40.7,
        geoLon: -74.0,
        playerName: 'Chrome',
        deviceId: 'dev-1',
        product: 'Plex Web',
        device: 'Chrome',
        platform: 'Chrome',
        quality: '1080p',
        isTranscode: false,
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        bitrate: 20000,
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([dbSession]),
                }),
              }),
            }),
          }),
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(403);
    });

    it('should deny access to cached session from wrong server', async () => {
      const serverId = randomUUID();
      const sessionId = randomUUID();
      const differentServerId = randomUUID();
      const viewerUser = createViewerUser([differentServerId]);

      const activeSession = createMockActiveSession({ id: sessionId, serverId });

      const redisMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(activeSession)),
      };

      app = await buildTestApp(viewerUser, redisMock);

      // Should fall through to DB since server access denied
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /sessions/history', () => {
    function createMockHistoryRow(overrides: Record<string, unknown> = {}) {
      return {
        id: randomUUID(),
        started_at: new Date(),
        stopped_at: new Date(),
        duration_ms: '3600000',
        paused_duration_ms: '0',
        progress_ms: 3600000,
        total_duration_ms: 7200000,
        segment_count: '1',
        segments: null,
        watched: true,
        state: 'stopped',
        server_id: randomUUID(),
        server_name: 'Test Server',
        server_type: 'plex',
        server_user_id: randomUUID(),
        username: 'testuser',
        user_thumb: null,
        identity_name: null,
        session_key: 'session-1',
        media_type: 'movie',
        media_title: 'Test Movie',
        grandparent_title: null,
        season_number: null,
        episode_number: null,
        year: 2024,
        artist_name: null,
        album_name: null,
        thumb_path: null,
        reference_id: null,
        ip_address: '192.168.1.1',
        geo_city: null,
        geo_region: null,
        geo_country: null,
        geo_continent: null,
        geo_postal: null,
        geo_lat: null,
        geo_lon: null,
        geo_asn_number: null,
        geo_asn_organization: null,
        player_name: null,
        device_id: null,
        product: null,
        device: null,
        platform: null,
        quality: null,
        is_transcode: false,
        dispatcharr_playback_kind: null,
        video_decision: null,
        audio_decision: null,
        bitrate: null,
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
        page_candidate_count: 1,
        ...overrides,
      };
    }

    it('returns mapped rows from a single query round trip', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const playId = randomUUID();
      const startedAt = new Date('2024-06-01T12:00:00Z');

      mockDb.execute.mockResolvedValueOnce({
        rows: [createMockHistoryRow({ id: playId, started_at: startedAt })],
      });

      const response = await app.inject({ method: 'GET', url: '/sessions/history' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(playId);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeUndefined();
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('returns Dispatcharr playback kind for history rows', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({
            server_type: 'dispatcharr',
            media_type: 'live',
            channel_title: 'Catch-up Channel',
            dispatcharr_playback_kind: 'catchup',
          }),
        ],
      });

      const response = await app.inject({ method: 'GET', url: '/sessions/history' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data[0].server.type).toBe('dispatcharr');
      expect(body.data[0].mediaType).toBe('live');
      expect(body.data[0].dispatcharrPlaybackKind).toBe('catchup');
    });

    it('scopes the join-back to the page-id CTE and time-bounds it by the page minimum', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [createMockHistoryRow()] });

      await app.inject({ method: 'GET', url: '/sessions/history?pageSize=1' });

      const { sql: query } = renderSql(mockDb.execute.mock.calls[0][0] as SQL);
      expect(query).toContain('history_page AS MATERIALIZED');
      expect(query).toContain('history_page_ids AS MATERIALIZED');
      expect(query).toContain(
        'COALESCE(s.reference_id, s.id) IN (SELECT play_id FROM history_page_ids)'
      );
      expect(query).toContain('s.started_at >= (SELECT MIN(started_at) FROM history_page_ids)');
      expect(query).toContain('s.started_at = gs.started_at');
    });

    it('returns an empty result in a single query when no plays match', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({ method: 'GET', url: '/sessions/history' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
      expect(body.hasMore).toBe(false);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('paginates a reference chain straddling the cursor without splitting or duplicating it', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const playX = randomUUID();
      const playXStart = new Date('2024-06-10T00:00:00Z');
      const playY = randomUUID();
      const playYStart = new Date('2024-05-01T00:00:00Z');

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({
            id: playX,
            started_at: playXStart,
            segment_count: '1',
            page_candidate_count: 2,
          }),
        ],
      });

      const page1 = await app.inject({ method: 'GET', url: '/sessions/history?pageSize=1' });
      const page1Body = JSON.parse(page1.body);
      expect(page1Body.data.map((row: { id: string }) => row.id)).toEqual([playX]);
      expect(page1Body.hasMore).toBe(true);
      expect(page1Body.nextCursor).toBe(`${playXStart.getTime()}_${playX}`);

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({
            id: playY,
            started_at: playYStart,
            segment_count: '2',
            page_candidate_count: 1,
          }),
        ],
      });

      const page2 = await app.inject({
        method: 'GET',
        url: `/sessions/history?pageSize=1&cursor=${page1Body.nextCursor}`,
      });
      const page2Body = JSON.parse(page2.body);
      expect(page2Body.data.map((row: { id: string }) => row.id)).toEqual([playY]);
      expect(page2Body.data[0].segmentCount).toBe(2);
      expect(page2Body.hasMore).toBe(false);

      const page1Ids = page1Body.data.map((row: { id: string }) => row.id);
      const page2Ids = page2Body.data.map((row: { id: string }) => row.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });

    it('aggregates every segment of a chain across a 45-day resume gap', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const playId = randomUUID();
      const earliestSegment = new Date('2024-01-01T00:00:00Z');
      const latestSegment = new Date('2024-02-15T00:00:00Z');

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({
            id: playId,
            started_at: earliestSegment,
            stopped_at: latestSegment,
            segment_count: '2',
            duration_ms: '7200000',
          }),
        ],
      });

      const response = await app.inject({ method: 'GET', url: '/sessions/history' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data[0].segmentCount).toBe(2);
      expect(body.data[0].durationMs).toBe(7200000);

      const { sql: query } = renderSql(mockDb.execute.mock.calls[0][0] as SQL);
      expect((query.match(/30 days/g) ?? []).length).toBe(1);
      expect(query).toContain('s.started_at >= (SELECT MIN(started_at) FROM history_page_ids)');
    });

    it('omits nextCursor when the page is not full', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const playId = randomUUID();
      const startedAt = new Date();

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({ id: playId, started_at: startedAt, page_candidate_count: 1 }),
        ],
      });

      const response = await app.inject({ method: 'GET', url: '/sessions/history?pageSize=50' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeUndefined();
    });

    it('rejects invalid query parameters', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/history?pageSize=0',
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects a malformed cursor before running any query', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/history?cursor=not-a-number_abc',
      });

      expect(response.statusCode).toBe(400);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('rejects a cursor whose id is not a uuid', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/history?cursor=1717027200000_not-a-real-uuid-garbage',
      });

      expect(response.statusCode).toBe(400);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('breaks ties on play id in every ORDER BY', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      mockDb.execute.mockResolvedValueOnce({ rows: [createMockHistoryRow()] });

      await app.inject({ method: 'GET', url: '/sessions/history' });

      const { sql: query } = renderSql(mockDb.execute.mock.calls[0][0] as SQL);
      const normalized = query.replace(/\s+/g, ' ');
      expect(normalized).toContain(
        'MIN(s.started_at) DESC, COALESCE(s.reference_id, s.id)::text DESC'
      );
      expect(normalized).toContain('ORDER BY gs.started_at DESC, gs.play_id::text DESC');
    });

    it('paginates two plays with an identical started_at without duplicating or dropping either', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const tiedTime = new Date('2024-06-10T00:00:00Z');
      const [firstId, secondId] = [randomUUID(), randomUUID()].sort().reverse();

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({ id: firstId, started_at: tiedTime, page_candidate_count: 2 }),
        ],
      });

      const page1 = await app.inject({ method: 'GET', url: '/sessions/history?pageSize=1' });
      const page1Body = JSON.parse(page1.body);
      expect(page1Body.data.map((row: { id: string }) => row.id)).toEqual([firstId]);
      expect(page1Body.nextCursor).toBe(`${tiedTime.getTime()}_${firstId}`);

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          createMockHistoryRow({ id: secondId, started_at: tiedTime, page_candidate_count: 1 }),
        ],
      });

      const page2 = await app.inject({
        method: 'GET',
        url: `/sessions/history?pageSize=1&cursor=${page1Body.nextCursor}`,
      });
      const page2Body = JSON.parse(page2.body);
      expect(page2Body.data.map((row: { id: string }) => row.id)).toEqual([secondId]);
      expect(page2Body.hasMore).toBe(false);

      const { params: page2Params } = renderSql(mockDb.execute.mock.calls[1][0] as SQL);
      expect(page2Params).toContain(firstId);
      expect(page2Params.some((p) => p instanceof Date && p.getTime() === tiedTime.getTime())).toBe(
        true
      );
    });
  });
});
