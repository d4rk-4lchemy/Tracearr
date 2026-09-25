import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { Redis } from 'ioredis';
import { createMockRedis } from '@tracearr/test-utils/mocks';
import { sessionRoutes } from '../../src/routes/sessions.js';
import { locationsRoutes } from '../../src/routes/stats/locations.js';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import {
  dispatcharrDeviceId,
  dispatcharrDeviceIdSql,
  dispatcharrUserAgentSql,
} from '../../src/services/mediaServer/dispatcharr/deviceIdentity.js';
import { queryUserDevices } from '../../src/routes/users/queries.js';
import { batchGetRecentUserSessions } from '../../src/jobs/poller/database.js';
import { compressSessionChunks } from '../../src/test/compressChunks.js';

async function account(type: 'dispatcharr' | 'plex' | 'jellyfin' | 'emby' = 'dispatcharr') {
  const server = await createTestServer({ type });
  const user = await createTestUser();
  const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });
  return { serverId: server.id, serverUserId: serverUser.id };
}

describe('Dispatcharr devices on TimescaleDB', () => {
  it('adds the fork column to an existing compressed history without rewriting connection IDs', async () => {
    const owner = await account();
    const row = await createTestSession({
      ...owner,
      deviceId: 'legacy-client',
      product: 'VLC/3.0',
      state: 'stopped',
      startedAt: new Date(Date.now() - 120 * 86400_000),
    });
    const migration = readFileSync(
      new URL('../../src/db/fork-migrations/0005_dispatcharr_user_agent.sql', import.meta.url),
      'utf8'
    );
    await db.execute(sql`ALTER TABLE sessions DROP COLUMN dispatcharr_user_agent`);
    try {
      expect((await compressSessionChunks(90)).length).toBeGreaterThan(0);
      await db.execute(sql.raw(migration));
      const result = await db.execute(
        sql`SELECT device_id, dispatcharr_user_agent FROM sessions WHERE id = ${row.id}::uuid`
      );
      expect(result.rows[0]).toMatchObject({
        device_id: 'legacy-client',
        dispatcharr_user_agent: null,
      });
      expect((await queryUserDevices(db, owner.serverUserId))[0]!.deviceId).toBe(
        dispatcharrDeviceId({ ...owner, product: 'VLC/3.0' })
      );
    } finally {
      await db.execute(sql.raw(migration));
    }
  });

  it('agrees with TypeScript for legacy/missing/full/unicode agents and reads compressed history', async () => {
    const owner = await account();
    const cases = [
      { dispatcharrUserAgent: null, product: ' VLC/3.0 ', playerName: 'old player' },
      { dispatcharrUserAgent: null, product: '', playerName: '\ufeffVLC/3.0\u00a0' },
      { dispatcharrUserAgent: '', product: 'stale', playerName: 'stale' },
      { dispatcharrUserAgent: null, product: null, playerName: 'Dispatcharr VOD Client' },
      { dispatcharrUserAgent: null, product: null, playerName: 'Dispatcharr Catch-up Client' },
      { dispatcharrUserAgent: ' \tTV/żółć "quoted" \\ agent\n\u2028', product: '', playerName: '' },
      { dispatcharrUserAgent: 'a'.repeat(255) + '1', product: 'a'.repeat(255), playerName: '' },
      { dispatcharrUserAgent: 'a'.repeat(255) + '2', product: 'a'.repeat(255), playerName: '' },
    ];
    const expected = new Map<string, string>();
    for (const [i, data] of cases.entries()) {
      const row = await createTestSession({
        ...owner,
        deviceId: `client-${i}`,
        state: 'stopped',
        startedAt: new Date(Date.now() - 120 * 86400_000 + i * 60_000),
      });
      await db.execute(sql`UPDATE sessions SET dispatcharr_user_agent = ${data.dispatcharrUserAgent},
        product = ${data.product}, player_name = ${data.playerName} WHERE id = ${row.id}::uuid`);
      expected.set(row.id, dispatcharrDeviceId({ ...owner, ...data }));
    }
    const assertIdentities = async () => {
      const rows = await db.execute(
        sql`SELECT id, ${dispatcharrDeviceIdSql()} AS identity FROM sessions`
      );
      expect(new Map(rows.rows.map((row) => [row.id, row.identity]))).toEqual(expected);
      const devices = await queryUserDevices(db, owner.serverUserId);
      expect(devices).toHaveLength(5);
      expect(devices.reduce((sum, row) => sum + row.sessionCount, 0)).toBe(cases.length);
    };
    await assertIdentities();
    expect((await compressSessionChunks(90)).length).toBeGreaterThan(0);
    // Adding the overlay column is idempotent even with compressed session chunks.
    await db.execute(
      sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS dispatcharr_user_agent text`
    );
    await assertIdentities();
  });

  it('merges legacy and new plays across IPs and keeps accounts and providers separate', async () => {
    const owner = await account();
    for (const [i, ipAddress] of ['1.1.1.1', '8.8.8.8'].entries()) {
      const row = await createTestSession({
        ...owner,
        deviceId: `client-${i}`,
        ipAddress,
        product: 'VLC/3.0',
        geoCity: i === 0 ? 'Paris' : 'Warsaw',
        geoCountry: i === 0 ? 'FR' : 'PL',
      });
      if (i === 1)
        await db.execute(
          sql`UPDATE sessions SET dispatcharr_user_agent = 'VLC/3.0' WHERE id = ${row.id}::uuid`
        );
    }
    const devices = await queryUserDevices(db, owner.serverUserId);
    const app = Fastify();
    await app.register(sensible);
    app.decorate('redis', createMockRedis() as unknown as Redis);
    app.decorate('authenticate', async (request) => {
      request.user = {
        userId: 'owner',
        username: 'owner',
        role: 'owner',
        serverIds: [],
      } as typeof request.user;
    });
    await app.register(sessionRoutes, { prefix: '/sessions' });
    await app.register(locationsRoutes, { prefix: '/stats' });
    try {
      const response = await app.inject(`/sessions/history?serverUserIds=${owner.serverUserId}`);
      expect(response.statusCode).toBe(200);
      const history = response.json().data;
      expect(history).toHaveLength(2);
      expect(
        history.map((row: { dispatcharrDeviceId: string }) => row.dispatcharrDeviceId)
      ).toEqual([devices[0]!.deviceId, devices[0]!.deviceId]);
      const detail = await app.inject(`/sessions/${history[0].id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().dispatcharrDeviceId).toBe(devices[0]!.deviceId);
      expect(detail.json()).not.toHaveProperty('dispatcharrUserAgent');
      const locations = await app.inject(
        `/stats/locations?period=all&serverUserId=${owner.serverUserId}`
      );
      expect(locations.statusCode).toBe(200);
      expect(
        locations.json().data.every((row: { deviceCount: number }) => row.deviceCount === 1)
      ).toBe(true);
    } finally {
      await app.close();
    }

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      deviceId: dispatcharrDeviceId({ ...owner, product: 'VLC/3.0' }),
      sessionCount: 2,
    });
    expect(devices[0]!.locations).toHaveLength(2);
    const recent = await batchGetRecentUserSessions([owner.serverUserId]);
    expect(recent.get(owner.serverUserId)!.map((s) => s.dispatcharrDeviceId)).toEqual([
      devices[0]!.deviceId,
      devices[0]!.deviceId,
    ]);
    expect(new Set(recent.get(owner.serverUserId)!.map((s) => s.deviceId)).size).toBe(2);
    // Same predicate used by account.new_device finds the legacy row too.
    const seen =
      await db.execute(sql`SELECT id FROM sessions WHERE server_user_id = ${owner.serverUserId}::uuid
      AND ${dispatcharrUserAgentSql()} = 'VLC/3.0'`);
    expect(seen.rows).toHaveLength(2);

    const second = await account();
    await createTestSession({ ...second, product: 'VLC/3.0', deviceId: 'client-0' });
    expect(await queryUserDevices(db, [owner.serverUserId, second.serverUserId])).toHaveLength(2);
    for (const type of ['plex', 'jellyfin', 'emby'] as const) {
      const other = await account(type);
      await createTestSession({ ...other, deviceId: 'machine-1', product: 'VLC/3.0' });
      await createTestSession({ ...other, deviceId: 'machine-2', product: 'VLC/3.0' });
      expect(
        (await queryUserDevices(db, other.serverUserId)).map((row) => row.deviceId).sort()
      ).toEqual(['machine-1', 'machine-2']);
    }
  });
});
