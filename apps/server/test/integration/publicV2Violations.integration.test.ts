/**
 * Public API v2 /violations integration tests
 *
 * Real token auth and a real database. Seeds one completed policy run, one
 * notification run, one stopped run and one dismissed violation under the
 * same account, and proves only the first is listed and resolvable by id.
 * Three rows with one created_at prove the cursor neither repeats nor drops.
 *
 * Run with: pnpm --filter @tracearr/server test:integration publicV2Violations
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { eq, sql } from 'drizzle-orm';
import {
  createTestAutomation,
  createTestRun,
  createTestServer,
  createTestServerUser,
  createTestSession,
  createTestUser,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { automationRuns, users } from '../../src/db/schema.js';
import authPlugin from '../../src/plugins/auth.js';
import { publicV2Routes } from '../../src/routes/publicV2/index.js';
import { getRedis } from '../../src/lib/redisShared.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(fastifyCookie, { secret: 'test-cookie-secret-32-chars-long!' });
  app.decorate('redis', getRedis());
  await app.register(authPlugin);
  await app.register(publicV2Routes, { prefix: '/api/v2/public' });
  return app;
}

async function seedOwnerToken(): Promise<string> {
  const owner = await createTestUser({ role: 'owner' });
  const token = `trr_pub_${randomUUID().replace(/-/g, '')}`;
  await db.update(users).set({ apiToken: token }).where(eq(users.id, owner.id));
  return token;
}

interface Row {
  id: string;
  acknowledged_at: string | null;
  user: { id: string; server_user_id: string };
}

describe('public API v2 /violations', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    token = await seedOwnerToken();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists only completed policy runs that are not dismissed, and resolves them by id', async () => {
    const server = await createTestServer();
    const person = await createTestUser();
    const account = await createTestServerUser({ userId: person.id, serverId: server.id });
    const session = await createTestSession({ serverId: server.id, serverUserId: account.id });
    const policy = await createTestAutomation({ kind: 'policy', severity: 'high' });
    const alert = await createTestAutomation({ kind: 'notification' });

    const kept = await createTestRun({
      automationId: policy.id,
      serverUserId: account.id,
      sessionId: session.id,
      severity: 'high',
    });
    await createTestRun({
      automationId: alert.id,
      serverUserId: account.id,
      sessionId: session.id,
      kind: 'notification',
    });
    await createTestRun({
      automationId: policy.id,
      serverUserId: account.id,
      sessionId: randomUUID(),
      outcome: 'stopped_by_condition',
    });
    const dismissed = await createTestRun({
      automationId: policy.id,
      serverUserId: account.id,
      sessionId: randomUUID(),
    });
    await db
      .update(automationRuns)
      .set({ dismissedAt: new Date() })
      .where(eq(automationRuns.id, dismissed.id));
    const orphan = await createTestRun({
      automationId: policy.id,
      serverUserId: account.id,
      sessionId: randomUUID(),
    });
    await db
      .update(automationRuns)
      .set({ serverUserId: null })
      .where(eq(automationRuns.id, orphan.id));

    const list = await app.inject({
      method: 'GET',
      url: '/api/v2/public/violations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json<{ data: Row[] }>().data;
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
    expect(rows[0]?.user).toEqual(
      expect.objectContaining({ id: person.id, server_user_id: account.id })
    );

    const byId = await app.inject({
      method: 'GET',
      url: `/api/v2/public/violations/${kept.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(byId.statusCode).toBe(200);
    expect(byId.json<{ actions: unknown[] }>().actions).toEqual([]);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/v2/public/violations/${dismissed.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.statusCode).toBe(404);

    const noAccount = await app.inject({
      method: 'GET',
      url: `/api/v2/public/violations/${orphan.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noAccount.statusCode).toBe(404);
  });

  it('walks pages of 1 through rows tied to the microsecond without repeats or gaps', async () => {
    const server = await createTestServer();
    const person = await createTestUser();
    const account = await createTestServerUser({ userId: person.id, serverId: server.id });
    const policy = await createTestAutomation({ kind: 'policy' });
    // Two rows share one microsecond and a third sits 333 us later; a millisecond
    // cursor would read all three as 10:00:05.000 and skip past the tie.
    const stamps = [
      '2026-10-06 10:00:05.000123+00',
      '2026-10-06 10:00:05.000123+00',
      '2026-10-06 10:00:05.000456+00',
    ];
    const ids: string[] = [];
    for (const stamp of stamps) {
      const session = await createTestSession({ serverId: server.id, serverUserId: account.id });
      const run = await createTestRun({
        automationId: policy.id,
        serverUserId: account.id,
        sessionId: session.id,
      });
      await db.execute(
        sql`UPDATE automation_runs SET created_at = ${stamp}::timestamptz WHERE id = ${run.id}::uuid`
      );
      ids.push(run.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const url: string =
        `/api/v2/public/violations?server_id=${server.id}&pageSize=1` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json<{ data: Row[]; meta: { nextCursor: string | null } }>();
      seen.push(...body.data.map((r) => r.id));
      cursor = body.meta.nextCursor;
      if (!cursor) break;
    }

    expect([...seen].sort()).toEqual([...ids].sort());
    expect(seen).toHaveLength(3);
  });
});
