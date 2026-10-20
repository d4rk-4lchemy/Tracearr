/**
 * Play statistics route tests
 *
 * Tests GET /stats/plays, including the frozen no-param contract mobile
 * consumes and the optional mediaType filter, and the groupBy=mediaType
 * breakdown on all three Activity routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { renderSql } from '../../../test/helpers.js';

// Mock database before imports
vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock server filtering utilities, mirroring the real implementation
vi.mock('../../../utils/serverFiltering.js', async () => {
  const { sql } = await import('drizzle-orm');
  const { ForbiddenError } = await import('../../../utils/errors.js');
  return {
    resolveServerIds: vi.fn((authUser, serverId, serverIds) => {
      if (serverId && authUser.role !== 'owner' && !authUser.serverIds.includes(serverId)) {
        throw new ForbiddenError('You do not have access to this server');
      }
      const requested = serverIds ?? (serverId ? [serverId] : undefined);
      if (authUser.role === 'owner') return requested ?? undefined;
      if (!requested) return authUser.serverIds;
      return requested.filter((id: string) => authUser.serverIds.includes(id));
    }),
    buildMultiServerFragment: vi.fn(() => sql``),
  };
});

// Mock resolveDateRange for deterministic bucketing
vi.mock('../utils.js', () => ({
  resolveDateRange: vi.fn((period: string, startDate?: string, endDate?: string) => {
    if (period === 'custom') {
      return {
        start: startDate ? new Date(startDate) : null,
        end: endDate ? new Date(endDate) : null,
      };
    }
    if (period === 'all') {
      return { start: null, end: new Date('2024-06-15T12:00:00Z') };
    }
    return {
      start: new Date('2024-06-08T12:00:00Z'),
      end: new Date('2024-06-15T12:00:00Z'),
    };
  }),
}));

import { db } from '../../../db/client.js';
import { playsRoutes } from '../plays.js';
import { permissionGuard } from '../../../lib/scope.js';

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));

  await app.register(playsRoutes, { prefix: '/stats' });

  return app;
}

function createOwnerUser(): AuthUser {
  return {
    userId: randomUUID(),
    username: 'owner',
    role: 'owner',
    serverIds: [],
  };
}

function createViewerUser(serverIds: string[]): AuthUser {
  return {
    userId: randomUUID(),
    username: 'viewer',
    role: 'admin',
    serverIds,
  };
}

// Fixed seed pinning the current /stats/plays no-param shape (mobile-consumed, frozen).
const PINNED_PLAYS_ROWS = [
  { date: '2024-06-08T00:00:00.000Z', serverId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', count: 5 },
  { date: '2024-06-09T00:00:00.000Z', serverId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', count: 3 },
];
const PINNED_PLAYS_RESPONSE = { data: PINNED_PLAYS_ROWS };

describe('Plays Routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /stats/plays', () => {
    it('pins the current no-param response shape byte-for-byte (frozen mobile contract)', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);
      vi.mocked(db.execute).mockResolvedValueOnce({ rows: PINNED_PLAYS_ROWS } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/stats/plays',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(PINNED_PLAYS_RESPONSE);

      // No mediaType filter clause should be present when the param is absent.
      const { sql: query } = renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as SQL);
      expect(query).not.toContain('media_type =');
      expect(query).toContain("AND media_type IN ('movie', 'episode', 'track', 'live')");
      expect(query).not.toContain('media_group');
    });

    it('groups by media type when groupBy=mediaType, music included', async () => {
      app = await buildTestApp(createOwnerUser());
      vi.mocked(db.execute).mockResolvedValueOnce({
        rows: [
          { ...PINNED_PLAYS_ROWS[0], media_group: 'show' },
          { ...PINNED_PLAYS_ROWS[0], count: 2, media_group: 'music' },
          { ...PINNED_PLAYS_ROWS[0], count: 3, media_group: 'live' },
        ],
      } as never);

      const response = await app.inject({ method: 'GET', url: '/stats/plays?groupBy=mediaType' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: [
          { ...PINNED_PLAYS_ROWS[0], mediaType: 'show' },
          { ...PINNED_PLAYS_ROWS[0], count: 2, mediaType: 'music' },
          { ...PINNED_PLAYS_ROWS[0], count: 3, mediaType: 'live' },
        ],
      });
      const { sql: query } = renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as SQL);
      expect(query).toContain('media_group');
      expect(query).toContain("AND media_type IN ('movie', 'episode', 'track', 'live')");
    });

    it('rejects an unknown groupBy', async () => {
      app = await buildTestApp(createOwnerUser());

      const response = await app.inject({ method: 'GET', url: '/stats/plays?groupBy=genre' });

      expect(response.statusCode).toBe(400);
    });

    it('filters to the requested mediaType and keeps the same response shape', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);
      const filteredRows = [
        {
          date: '2024-06-08T00:00:00.000Z',
          serverId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          count: 2,
        },
      ];
      vi.mocked(db.execute).mockResolvedValueOnce({ rows: filteredRows } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/stats/plays?mediaType=movie',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: filteredRows });

      const { sql: query, params } = renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as SQL);
      expect(query).toContain('media_type =');
      expect(params).toContain('movie');
    });

    it('accepts mediaType=episode', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);
      vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/stats/plays?mediaType=episode',
      });

      expect(response.statusCode).toBe(200);
      const { params } = renderSql(vi.mocked(db.execute).mock.calls[0]?.[0] as SQL);
      expect(params).toContain('episode');
    });

    it.each(['live', 'track'])('accepts mediaType=%s', async (mediaType) => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);
      vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as never);

      const response = await app.inject({
        method: 'GET',
        url: `/stats/plays?mediaType=${mediaType}`,
      });

      expect(response.statusCode).toBe(200);
      const { params } = renderSql(vi.mocked(db.execute).mock.calls[0]![0] as SQL);
      expect(params).toContain(mediaType);
    });

    it('rejects a mediaType value outside the Activity media types', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/stats/plays?mediaType=photo',
      });

      expect(response.statusCode).toBe(400);
    });

    it('still validates and rejects invalid serverId', async () => {
      const ownerUser = createOwnerUser();
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'GET',
        url: '/stats/plays?serverId=not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects access to unauthorized server', async () => {
      const authorizedServer = randomUUID();
      const unauthorizedServer = randomUUID();
      const viewerUser = createViewerUser([authorizedServer]);
      app = await buildTestApp(viewerUser);

      const response = await app.inject({
        method: 'GET',
        url: `/stats/plays?serverId=${unauthorizedServer}`,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /stats/plays-by-dayofweek and /stats/plays-by-hourofday', () => {
    it('keep the primary media filter and the 7 and 24 rows without groupBy', async () => {
      app = await buildTestApp(createOwnerUser());
      vi.mocked(db.execute).mockResolvedValue({ rows: [{ day: 1, hour: 1, count: 4 }] } as never);

      const days = await app.inject({ method: 'GET', url: '/stats/plays-by-dayofweek' });
      const hours = await app.inject({ method: 'GET', url: '/stats/plays-by-hourofday' });

      expect(days.json().data).toHaveLength(7);
      expect(days.json().data[1]).toEqual({ day: 1, name: 'Mon', count: 4 });
      expect(hours.json().data).toHaveLength(24);
      expect(hours.json().data[1]).toEqual({ hour: 1, count: 4 });
      for (const call of vi.mocked(db.execute).mock.calls) {
        const { sql: query } = renderSql(call[0] as SQL);
        expect(query).toContain("AND media_type IN ('movie', 'episode', 'track', 'live')");
        expect(query).not.toContain('media_group');
      }
    });

    it('zero-fill each media group with groupBy=mediaType', async () => {
      app = await buildTestApp(createOwnerUser());
      vi.mocked(db.execute).mockResolvedValue({
        rows: [{ day: 1, hour: 1, count: 4, media_group: 'music' }],
      } as never);

      const days = await app.inject({
        method: 'GET',
        url: '/stats/plays-by-dayofweek?groupBy=mediaType',
      });
      const hours = await app.inject({
        method: 'GET',
        url: '/stats/plays-by-hourofday?groupBy=mediaType',
      });

      const dayRows = days.json().data as { day: number; count: number; mediaType: string }[];
      expect(dayRows).toHaveLength(28);
      for (const group of ['movie', 'show', 'music', 'live']) {
        expect(dayRows.filter((row) => row.mediaType === group)).toHaveLength(7);
      }
      expect(dayRows.filter((row) => row.count > 0)).toEqual([
        { day: 1, name: 'Mon', count: 4, mediaType: 'music' },
      ]);

      const hourRows = hours.json().data as { hour: number; count: number; mediaType: string }[];
      expect(hourRows).toHaveLength(96);
      expect(hourRows.filter((row) => row.count > 0)).toEqual([
        { hour: 1, count: 4, mediaType: 'music' },
      ]);

      for (const call of vi.mocked(db.execute).mock.calls) {
        const { sql: query } = renderSql(call[0] as SQL);
        expect(query).toContain('media_group');
        expect(query).toContain("AND media_type IN ('movie', 'episode', 'track', 'live')");
      }
    });
  });
});
