/**
 * Mobile Better Auth shim tests (Task 13)
 *
 * Verifies the pair/refresh endpoints and the requireMobile decorator run on
 * Better Auth sessions while keeping the frozen wire contract
 * (mobileContract.test.ts) intact:
 * - pairing creates a Better Auth backed session (betterAuthSessionId stored,
 *   both tokens are the BA session token)
 * - the pair accessToken authenticates requireMobile endpoints as a bearer
 * - refresh keeps its response shape for BA pairings without rotating
 * - legacy mobile JWTs still authenticate requireMobile
 * - revoking a device deletes the linked Better Auth session
 *
 * Like the sibling routes tests, this runs against a mocked db and Redis
 * (no live Postgres/Redis in this suite); getAuth() is stubbed the same way
 * authDecorators.test.ts stubs it. The real end-to-end pair flow with a live
 * createSession belongs to the live-DB integration gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import type { SQL } from 'drizzle-orm';

const clientFloor = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('@tracearr/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tracearr/shared')>()),
  get MIN_MOBILE_CLIENT_VERSION() {
    return clientFloor.value;
  },
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../services/termination.js', () => ({
  terminateSession: vi.fn(),
}));

vi.mock('../../websocket/index.js', () => ({
  disconnectMobileDevice: vi.fn(),
}));

vi.mock('../../services/settings.js', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock('../../lib/auth.js', () => ({
  getAuth: vi.fn(),
}));

import { db } from '../../db/client.js';
import { getAuth } from '../../lib/auth.js';
import { getSetting } from '../../services/settings.js';
import { mobileSessions, mobileTokens, users, servers, authSessions } from '../../db/schema.js';
import { hashSha256 } from '../../utils/hash.js';
import { renderSql } from '../../test/helpers.js';
import authPlugin, { loadJwtRevokeSettings } from '../../plugins/auth.js';
import { mobileRoutes } from '../mobile.js';
import { registerErrorHandler } from '../../utils/errors.js';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
  ttl: vi.fn(),
  multi: vi.fn(() => ({
    del: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    setex: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 1],
      [null, 'OK'],
    ]),
  })),
};

const OWNER_ID = randomUUID();
const SERVER_ID = randomUUID();
const BA_SESSION_ID = 'ba-session-id-1';
const BA_TOKEN = 'ba-session-token-1';
const WEB_TOKEN = 'ba-web-token-1';
const WEB_SESSION_ID = 'ba-web-session-id-1';
const DEVICE_ID = 'device-1';

const revokedTokens = new Set<string>();
const createSession = vi.fn();
const deleteSession = vi.fn();
const getSession = vi.fn();

function stubGetAuth() {
  revokedTokens.clear();
  createSession.mockReset().mockResolvedValue({
    id: BA_SESSION_ID,
    token: BA_TOKEN,
    userId: OWNER_ID,
  });
  deleteSession.mockReset().mockImplementation(async (token: string) => {
    revokedTokens.add(token);
  });
  getSession.mockReset().mockImplementation(async ({ headers }: { headers: Headers }) => {
    const auth = headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || revokedTokens.has(token)) return null;
    if (token === BA_TOKEN) {
      return {
        user: { id: OWNER_ID, name: 'owner', username: 'owner', role: 'owner' },
        session: { id: BA_SESSION_ID },
      };
    }
    if (token === WEB_TOKEN) {
      return {
        user: { id: OWNER_ID, name: 'owner', username: 'owner', role: 'owner' },
        session: { id: WEB_SESSION_ID },
      };
    }
    return null;
  });
  vi.mocked(getAuth).mockReturnValue({
    api: { getSession },
    $context: Promise.resolve({ internalAdapter: { createSession, deleteSession } }),
  } as unknown as ReturnType<typeof getAuth>);
}

// Routes db.select()/tx.select() to canned rows by table identity so the
// tests don't depend on query call order.
interface Chain {
  where: () => Chain;
  orderBy: () => Chain;
  for: () => Chain;
  limit: () => Promise<unknown[]>;
  then: (
    resolve: (value: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>;
}

function chainFor(rows: unknown[]): Chain {
  const chain: Chain = {
    where: () => chain,
    orderBy: () => chain,
    for: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

function routeSelects(rowsByTable: Map<unknown, unknown[]>) {
  vi.mocked(db.select).mockImplementation((() => ({
    from: (table: unknown) => chainFor(rowsByTable.get(table) ?? []),
  })) as never);
}

// Revoke deletes the row with .where().returning(); other deletes await .where().
function deleteReturning(rows: unknown[]) {
  const where = vi.fn(() => ({
    returning: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  }));
  vi.mocked(db.delete).mockReturnValue({ where } as never);
}

function createMockToken() {
  return {
    id: randomUUID(),
    tokenHash: 'tokenhash123',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    usedAt: null,
    createdBy: OWNER_ID,
    createdAt: new Date(),
  };
}

function baMobileSessionRow(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    userId: OWNER_ID,
    refreshTokenHash: hashSha256(BA_TOKEN),
    previousRefreshTokenHash: null,
    betterAuthSessionId: BA_SESSION_ID,
    deviceName: 'Test Phone',
    deviceId: DEVICE_ID,
    platform: 'ios' as const,
    expoPushToken: null,
    deviceSecret: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(sensible);
  registerErrorHandler(app);
  app.decorate('redis', mockRedis as never);
  await app.register(authPlugin);
  await app.register(mobileRoutes, { prefix: '/mobile' });
  return app;
}

describe('mobile better auth shim', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.update).mockReset();
    vi.mocked(db.delete).mockReset();
    vi.mocked(db.transaction).mockReset();
    mockRedis.get.mockReset().mockResolvedValue(null);
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.setex.mockReset().mockResolvedValue('OK');
    mockRedis.del.mockReset().mockResolvedValue(1);
    mockRedis.eval.mockReset().mockResolvedValue(1);
    mockRedis.ttl.mockReset().mockResolvedValue(0);
    stubGetAuth();

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
    deleteReturning([]);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('pairing creates a better auth backed session', async () => {
    app = await buildTestApp();

    routeSelects(new Map([[mobileSessions, []]]));

    const insertedValues: Record<string, unknown>[] = [];
    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      const txRows = new Map<unknown, unknown[]>([
        [mobileTokens, [createMockToken()]],
        [users, [{ id: OWNER_ID, username: 'owner', role: 'owner' }]],
        [servers, [{ id: SERVER_ID, name: 'MyServer', type: 'plex' }]],
      ]);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => ({
          from: (table: unknown) => chainFor(txRows.get(table) ?? []),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(async (v: Record<string, unknown>) => {
            insertedValues.push(v);
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return callback(tx as never);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/mobile/pair',
      payload: {
        token: 'trr_mob_validtokenvalue12345678901234567890',
        deviceName: 'Test Phone',
        deviceId: DEVICE_ID,
        platform: 'ios',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBe(BA_TOKEN);
    expect(body.refreshToken).toBe(BA_TOKEN);
    expect(createSession).toHaveBeenCalledWith(OWNER_ID);

    const sessionInsert = insertedValues.find((v) => v.deviceId === DEVICE_ID);
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.betterAuthSessionId).toBe(BA_SESSION_ID);
    expect(sessionInsert?.refreshTokenHash).toBe(hashSha256(BA_TOKEN));
  });

  it('the pair accessToken authenticates requireMobile endpoints', async () => {
    app = await buildTestApp();

    routeSelects(
      new Map<unknown, unknown[]>([
        [servers, [{ id: SERVER_ID }]],
        [mobileSessions, [baMobileSessionRow()]],
        [
          users,
          [
            {
              id: OWNER_ID,
              username: 'owner',
              name: null,
              thumbnail: null,
              email: null,
              role: 'owner',
            },
          ],
        ],
      ])
    );

    const res = await app.inject({
      method: 'GET',
      url: '/mobile/me',
      headers: { authorization: `Bearer ${BA_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('owner');
  });

  it('denies a better auth bearer with no mobile session row', async () => {
    app = await buildTestApp();

    routeSelects(
      new Map<unknown, unknown[]>([
        [servers, [{ id: SERVER_ID }]],
        [mobileSessions, []],
      ])
    );

    const res = await app.inject({
      method: 'GET',
      url: '/mobile/me',
      headers: { authorization: `Bearer ${BA_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTH_007');
  });

  it('denies a blacklisted better auth device', async () => {
    app = await buildTestApp();

    routeSelects(
      new Map<unknown, unknown[]>([
        [servers, [{ id: SERVER_ID }]],
        [mobileSessions, [baMobileSessionRow()]],
      ])
    );
    mockRedis.get.mockImplementation(async (key: string) =>
      key.includes('blacklist') ? '1' : null
    );

    const res = await app.inject({
      method: 'GET',
      url: '/mobile/me',
      headers: { authorization: `Bearer ${BA_TOKEN}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Session has been revoked');
    expect(res.json().code).toBe('AUTH_005');
  });

  it('refresh returns the same shape for a better auth pairing', async () => {
    app = await buildTestApp();

    mockRedis.get.mockResolvedValue(JSON.stringify({ userId: OWNER_ID, deviceId: DEVICE_ID }));
    routeSelects(
      new Map<unknown, unknown[]>([
        [users, [{ id: OWNER_ID, username: 'owner', role: 'owner' }]],
        [mobileSessions, [baMobileSessionRow()]],
      ])
    );

    const res = await app.inject({
      method: 'POST',
      url: '/mobile/refresh',
      payload: { refreshToken: BA_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken']);
    expect(body.accessToken).toBe(BA_TOKEN);
    expect(body.refreshToken).toBe(BA_TOKEN);
    expect(getSession).toHaveBeenCalled();
  });

  it('refresh rejects a revoked better auth token', async () => {
    app = await buildTestApp();

    revokedTokens.add(BA_TOKEN);
    mockRedis.get.mockResolvedValue(JSON.stringify({ userId: OWNER_ID, deviceId: DEVICE_ID }));
    routeSelects(
      new Map<unknown, unknown[]>([
        [users, [{ id: OWNER_ID, username: 'owner', role: 'owner' }]],
        [mobileSessions, [baMobileSessionRow()]],
      ])
    );

    const res = await app.inject({
      method: 'POST',
      url: '/mobile/refresh',
      payload: { refreshToken: BA_TOKEN },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Invalid or expired refresh token');
  });

  it('a legacy JWT still authenticates requireMobile', async () => {
    app = await buildTestApp();

    routeSelects(
      new Map<unknown, unknown[]>([
        [
          users,
          [
            {
              id: OWNER_ID,
              username: 'owner',
              name: null,
              thumbnail: null,
              email: null,
              role: 'owner',
            },
          ],
        ],
      ])
    );

    const legacyToken = app.jwt.sign({
      userId: OWNER_ID,
      username: 'owner',
      role: 'owner',
      serverIds: [SERVER_ID],
      mobile: true,
      deviceId: 'legacy-device',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/mobile/me',
      headers: { authorization: `Bearer ${legacyToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('owner');
  });

  it('revoking the device kills the better auth session too', async () => {
    app = await buildTestApp();

    const sessionRow = baMobileSessionRow();
    routeSelects(
      new Map<unknown, unknown[]>([
        [servers, [{ id: SERVER_ID }]],
        [mobileSessions, [sessionRow]],
        [authSessions, [{ token: BA_TOKEN }]],
      ])
    );

    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/mobile/sessions/${sessionRow.id}`,
      headers: { authorization: `Bearer ${WEB_TOKEN}` },
    });

    expect(revokeRes.statusCode).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith(BA_TOKEN);

    // The revoked bearer no longer resolves a Better Auth session
    routeSelects(
      new Map<unknown, unknown[]>([
        [servers, [{ id: SERVER_ID }]],
        [mobileSessions, [sessionRow]],
      ])
    );
    const res = await app.inject({
      method: 'GET',
      url: '/mobile/me',
      headers: { authorization: `Bearer ${BA_TOKEN}` },
    });
    expect(res.statusCode).toBe(401);
  });

  describe('legacy pairing swap', () => {
    const LEGACY_TOKEN = 'legacy-refresh-token';
    const LEGACY_HASH = hashSha256(LEGACY_TOKEN);
    const OWNER_ROW = { id: OWNER_ID, username: 'owner', role: 'owner' };

    function legacyRow() {
      return baMobileSessionRow({ betterAuthSessionId: null, refreshTokenHash: LEGACY_HASH });
    }

    function storedRefreshKey() {
      mockRedis.get.mockImplementation(async (key: string) =>
        key.includes(`mobile_refresh:${LEGACY_HASH}`)
          ? JSON.stringify({ userId: OWNER_ID, deviceId: DEVICE_ID })
          : null
      );
    }

    function updateReturning(rows: unknown[]) {
      const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) });
      const set = vi.fn().mockReturnValue({ where });
      vi.mocked(db.update).mockReturnValue({ set } as never);
      return { set, where };
    }

    function refreshLegacy() {
      return app.inject({
        method: 'POST',
        url: '/mobile/refresh',
        payload: { refreshToken: LEGACY_TOKEN },
      });
    }

    it('swaps a legacy token for a better auth session', async () => {
      app = await buildTestApp();
      storedRefreshKey();
      const row = legacyRow();
      routeSelects(
        new Map<unknown, unknown[]>([
          [users, [OWNER_ROW]],
          [mobileSessions, [row]],
        ])
      );
      const { set, where } = updateReturning([{ id: row.id }]);
      const multi = {
        expire: vi.fn().mockReturnThis(),
        setex: vi.fn().mockReturnThis(),
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      mockRedis.multi.mockReturnValueOnce(multi);

      const res = await refreshLegacy();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accessToken: BA_TOKEN, refreshToken: BA_TOKEN });
      expect(createSession).toHaveBeenCalledWith(OWNER_ID);
      expect(set).toHaveBeenCalledWith({
        betterAuthSessionId: BA_SESSION_ID,
        refreshTokenHash: hashSha256(BA_TOKEN),
        previousRefreshTokenHash: LEGACY_HASH,
        lastSeenAt: expect.any(Date),
      });
      const condition = renderSql(where.mock.calls[0]![0] as SQL);
      expect(condition.sql).toBe(
        '(mobile_sessions.id = $1 and mobile_sessions.refresh_token_hash = $2)'
      );
      expect(condition.params).toEqual([row.id, LEGACY_HASH]);
      expect(multi.expire).toHaveBeenCalledWith(`tracearr:mobile_refresh:${LEGACY_HASH}`, 90);
      expect(multi.setex).toHaveBeenCalledWith(
        `tracearr:mobile_refresh:${hashSha256(BA_TOKEN)}`,
        90 * 24 * 60 * 60,
        JSON.stringify({ userId: OWNER_ID, deviceId: DEVICE_ID })
      );
      // A revoke racing this swap sets the blacklist; the swap must never clear it.
      expect(multi.del).not.toHaveBeenCalled();
      expect(deleteSession).not.toHaveBeenCalled();
    });

    it('answers a legacy token inside its grace window with the current token', async () => {
      app = await buildTestApp();
      storedRefreshKey();
      routeSelects(
        new Map<unknown, unknown[]>([
          [users, [OWNER_ROW]],
          [mobileSessions, [baMobileSessionRow({ previousRefreshTokenHash: LEGACY_HASH })]],
          [authSessions, [{ token: BA_TOKEN }]],
        ])
      );

      const res = await refreshLegacy();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accessToken: BA_TOKEN, refreshToken: BA_TOKEN });
      expect(getSession).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });

    it('answers a legacy token past its grace window with AUTH_002', async () => {
      app = await buildTestApp();
      routeSelects(new Map<unknown, unknown[]>([[mobileSessions, []]]));

      const res = await refreshLegacy();

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_002');
      expect(createSession).not.toHaveBeenCalled();
    });

    it('drops its own session and returns the winner token when it loses the race', async () => {
      app = await buildTestApp();
      storedRefreshKey();
      const row = legacyRow();
      const sessionReads = [
        [row],
        [{ betterAuthSessionId: 'winner-session-id', previousRefreshTokenHash: LEGACY_HASH }],
      ];
      vi.mocked(db.select).mockImplementation((() => ({
        from: (table: unknown) => {
          if (table === users) return chainFor([OWNER_ROW]);
          if (table === authSessions) return chainFor([{ token: 'winner-token' }]);
          return chainFor(sessionReads.shift() ?? []);
        },
      })) as never);
      updateReturning([]);

      const res = await refreshLegacy();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accessToken: 'winner-token', refreshToken: 'winner-token' });
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(deleteSession).toHaveBeenCalledTimes(1);
      expect(deleteSession).toHaveBeenCalledWith(BA_TOKEN);
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(mockRedis.multi).not.toHaveBeenCalled();
    });

    it('a revoke that read the legacy row still kills the session a racing swap made', async () => {
      app = await buildTestApp();
      const legacy = legacyRow();
      routeSelects(
        new Map<unknown, unknown[]>([
          [servers, [{ id: SERVER_ID }]],
          [mobileSessions, [legacy]],
          [authSessions, [{ token: BA_TOKEN }]],
        ])
      );
      // The swap committed between the revoke's read and its delete.
      deleteReturning([
        {
          ...legacy,
          betterAuthSessionId: BA_SESSION_ID,
          refreshTokenHash: hashSha256(BA_TOKEN),
          previousRefreshTokenHash: LEGACY_HASH,
        },
      ]);

      const res = await app.inject({
        method: 'DELETE',
        url: `/mobile/sessions/${legacy.id}`,
        headers: { authorization: `Bearer ${WEB_TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      expect(deleteSession).toHaveBeenCalledWith(BA_TOKEN);
      const thirtyDays = 30 * 24 * 60 * 60;
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `tracearr:mobile:revoked:${hashSha256(BA_TOKEN)}`,
        thirtyDays,
        '1'
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `tracearr:mobile:revoked:${LEGACY_HASH}`,
        thirtyDays,
        '1'
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `tracearr:mobile:blacklist:${DEVICE_ID}`,
        expect.any(Number),
        '1'
      );
      expect(mockRedis.del).toHaveBeenCalledWith(`tracearr:mobile_refresh:${hashSha256(BA_TOKEN)}`);
    });

    it('a re-pair revokes the session a racing swap made, read under lock', async () => {
      app = await buildTestApp();
      // The unlocked read before the transaction still sees the legacy row.
      routeSelects(
        new Map<unknown, unknown[]>([
          [mobileSessions, [legacyRow()]],
          [authSessions, [{ token: 'swap-token' }]],
        ])
      );
      const swapped = {
        ...legacyRow(),
        betterAuthSessionId: 'swap-session-id',
        refreshTokenHash: hashSha256('swap-token'),
        previousRefreshTokenHash: LEGACY_HASH,
      };
      const txRows = new Map<unknown, unknown[]>([
        [mobileTokens, [createMockToken()]],
        [users, [OWNER_ROW]],
        [servers, [{ id: SERVER_ID, name: 'MyServer', type: 'plex' }]],
        [mobileSessions, [swapped]],
      ]);
      const lockedTables: unknown[] = [];
      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockImplementation(() => ({
            from: (table: unknown) => {
              const rows = txRows.get(table) ?? [];
              return {
                orderBy: () => chainFor(rows),
                where: () => ({
                  limit: () => Promise.resolve(rows),
                  for: (mode: string) => {
                    if (mode === 'update') lockedTables.push(table);
                    return chainFor(rows);
                  },
                }),
              };
            },
          })),
          insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          }),
        };
        return callback(tx as never);
      });

      const res = await app.inject({
        method: 'POST',
        url: '/mobile/pair',
        payload: {
          token: 'trr_mob_validtokenvalue12345678901234567890',
          deviceName: 'Test Phone',
          deviceId: DEVICE_ID,
          platform: 'ios',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(lockedTables).toContain(mobileSessions);
      expect(deleteSession).toHaveBeenCalledWith('swap-token');
      expect(mockRedis.del).toHaveBeenCalledWith(
        `tracearr:mobile_refresh:${hashSha256('swap-token')}`
      );
    });

    it('answers AUTH_002 when the row changed under it for another reason', async () => {
      app = await buildTestApp();
      storedRefreshKey();
      const sessionReads = [
        [legacyRow()],
        [{ betterAuthSessionId: 'repaired-session-id', previousRefreshTokenHash: null }],
      ];
      vi.mocked(db.select).mockImplementation((() => ({
        from: (table: unknown) => {
          if (table === users) return chainFor([OWNER_ROW]);
          if (table === authSessions) return chainFor([{ token: 'repaired-token' }]);
          return chainFor(sessionReads.shift() ?? []);
        },
      })) as never);
      updateReturning([]);

      const res = await refreshLegacy();

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_002');
      expect(deleteSession).toHaveBeenCalledWith(BA_TOKEN);
    });
  });

  describe('failure codes', () => {
    function meAs(token: string) {
      return app.inject({
        method: 'GET',
        url: '/mobile/me',
        headers: { authorization: `Bearer ${token}` },
      });
    }

    it('answers an unknown bearer with AUTH_002', async () => {
      app = await buildTestApp();
      routeSelects(new Map<unknown, unknown[]>([[mobileSessions, []]]));

      const res = await meAs('unknown-token');

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        statusCode: 401,
        error: 'UnauthorizedError',
        message: 'Invalid or expired token',
        code: 'AUTH_002',
      });
    });

    it('answers a request with no credentials as before, with AUTH_002', async () => {
      app = await buildTestApp();

      const res = await app.inject({ method: 'GET', url: '/mobile/me' });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Invalid or expired token');
      expect(res.json().code).toBe('AUTH_002');
    });

    it('answers a web cookie session with no bearer with 403 AUTH_007', async () => {
      app = await buildTestApp();
      routeSelects(new Map<unknown, unknown[]>([[servers, [{ id: SERVER_ID }]]]));
      getSession.mockResolvedValueOnce({
        user: { id: OWNER_ID, name: 'owner', username: 'owner', role: 'owner' },
        session: { id: WEB_SESSION_ID },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/mobile/me',
        headers: { cookie: 'better-auth.session_token=web' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe('Mobile access token required');
      expect(res.json().code).toBe('AUTH_007');
    });

    it('answers a paired device whose session expired with AUTH_003', async () => {
      app = await buildTestApp();
      revokedTokens.add(BA_TOKEN);
      routeSelects(new Map<unknown, unknown[]>([[mobileSessions, [baMobileSessionRow()]]]));

      const res = await meAs(BA_TOKEN);

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Invalid or expired token');
      expect(res.json().code).toBe('AUTH_003');
    });

    it('answers a revoked device with AUTH_005 from its tombstone', async () => {
      app = await buildTestApp();
      revokedTokens.add(BA_TOKEN);
      routeSelects(new Map<unknown, unknown[]>([[mobileSessions, []]]));
      mockRedis.get.mockImplementation(async (key: string) =>
        key.includes(`mobile:revoked:${hashSha256(BA_TOKEN)}`) ? '1' : null
      );

      const res = await meAs(BA_TOKEN);

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_005');
    });

    it('answers 503 SRV_002 when redis fails during the lookup', async () => {
      app = await buildTestApp();
      routeSelects(
        new Map<unknown, unknown[]>([
          [servers, [{ id: SERVER_ID }]],
          [mobileSessions, [baMobileSessionRow()]],
        ])
      );
      mockRedis.get.mockRejectedValue(new Error('redis down'));

      const res = await meAs(BA_TOKEN);

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        statusCode: 503,
        error: 'ServiceUnavailableError',
        message: 'Auth store unavailable',
        code: 'SRV_002',
      });
    });

    it('answers 503 SRV_002 when the better auth lookup fails', async () => {
      app = await buildTestApp();
      getSession.mockRejectedValueOnce(new Error('db down'));

      const res = await meAs(BA_TOKEN);

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('SRV_002');
    });

    describe('legacy JWT', () => {
      function legacyToken(deviceId: string) {
        return app.jwt.sign({
          userId: OWNER_ID,
          username: 'owner',
          role: 'owner',
          serverIds: [SERVER_ID],
          mobile: true,
          deviceId,
        });
      }

      afterEach(async () => {
        vi.mocked(getSetting).mockResolvedValue(null as never);
        await loadJwtRevokeSettings();
      });

      it('answers a JWT issued before jwtRevokedBefore with AUTH_006', async () => {
        app = await buildTestApp();
        const token = legacyToken('legacy-device');
        vi.mocked(getSetting).mockResolvedValue(
          new Date(Date.now() + 60_000).toISOString() as never
        );
        await loadJwtRevokeSettings();

        const res = await meAs(token);

        expect(res.statusCode).toBe(401);
        expect(res.json().message).toBe('Session invalidated. Please log in again');
        expect(res.json().code).toBe('AUTH_006');
      });

      it('answers a blacklisted legacy device with AUTH_005', async () => {
        app = await buildTestApp();
        mockRedis.get.mockImplementation(async (key: string) =>
          key.includes('blacklist:legacy-device') ? '1' : null
        );

        const res = await meAs(legacyToken('legacy-device'));

        expect(res.statusCode).toBe(401);
        expect(res.json().message).toBe('Session has been revoked');
        expect(res.json().code).toBe('AUTH_005');
      });
    });

    describe('client floor', () => {
      beforeEach(() => {
        clientFloor.value = '2026.10.1';
        routeSelects(
          new Map<unknown, unknown[]>([
            [servers, [{ id: SERVER_ID }]],
            [mobileSessions, [baMobileSessionRow()]],
            [
              users,
              [
                {
                  id: OWNER_ID,
                  username: 'owner',
                  name: null,
                  thumbnail: null,
                  email: null,
                  role: 'owner',
                },
              ],
            ],
          ])
        );
      });

      afterEach(() => {
        clientFloor.value = null;
      });

      it('answers a client below the floor with 426 AUTH_008', async () => {
        app = await buildTestApp();

        const res = await app.inject({
          method: 'GET',
          url: '/mobile/me',
          headers: { authorization: `Bearer ${BA_TOKEN}`, 'x-tracearr-client': 'mobile/2026.9.3' },
        });

        expect(res.statusCode).toBe(426);
        expect(res.json().error).toBe('UpgradeRequiredError');
        expect(res.json().code).toBe('AUTH_008');
      });

      it.each([
        ['at the floor', 'mobile/2026.10.1'],
        ['without the header', undefined],
        ['with an unparsable header', 'mobile/garbage'],
      ])('lets a client %s through', async (_label, client) => {
        app = await buildTestApp();

        const res = await app.inject({
          method: 'GET',
          url: '/mobile/me',
          headers: {
            authorization: `Bearer ${BA_TOKEN}`,
            ...(client && { 'x-tracearr-client': client }),
          },
        });

        expect(res.statusCode).toBe(200);
      });
    });
  });
});
