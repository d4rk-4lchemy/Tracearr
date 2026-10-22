/**
 * The stale sweep against open rows older than the old seven-day bound: one in an
 * uncompressed chunk, which the recurring sweep now reaches, and one in a compressed
 * chunk, which only the startup pass reads. Both stop at their last poll so a row left
 * open through downtime is not credited with the outage.
 *
 * Run with: pnpm --filter @tracearr/server test:integration staleSweepHistory
 */

import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { db, recreatePool } from '../../src/db/client.js';
import { sessions } from '../../src/db/schema.js';
import { compressSessionChunks } from '../../src/test/compressChunks.js';
import { sweepStaleSessions } from '../../src/jobs/poller/processor.js';

const DAY_MS = 86_400_000;

async function openSession(daysAgo: number) {
  const server = await createTestServer({ type: 'plex' });
  const user = await createTestUser();
  const account = await createTestServerUser({ serverId: server.id, userId: user.id });
  const startedAt = new Date(Date.now() - daysAgo * DAY_MS);
  const lastSeenAt = new Date(startedAt.getTime() + 10 * 60_000);
  const session = await createTestSession({
    serverId: server.id,
    serverUserId: account.id,
    state: 'playing',
    startedAt,
    lastSeenAt,
    progressMs: 0,
  });
  return { server, account, session, startedAt, lastSeenAt };
}

async function readSession(id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row;
}

describe('stale sweep beyond seven days', () => {
  it('closes an open row in an uncompressed chunk at its last poll', async () => {
    const { session, lastSeenAt } = await openSession(20);

    await sweepStaleSessions();

    const row = await readSession(session.id);
    expect(row?.stoppedAt?.getTime()).toBe(lastSeenAt.getTime());
    expect(row?.forceStopped).toBe(true);
    expect(row?.durationMs).toBe(10 * 60_000);
  });

  it(
    'leaves a compressed open row to the startup pass, which closes it under a low decompression cap',
    { timeout: 120_000 },
    async () => {
      const { server, session, startedAt, lastSeenAt } = await openSession(120);
      // A neighboring segment the stop must not decompress along with its own.
      const other = await createTestServerUser({
        serverId: server.id,
        userId: (await createTestUser()).id,
      });
      for (let i = 0; i < 40; i++) {
        await createTestSession({
          serverId: server.id,
          serverUserId: other.id,
          state: 'stopped',
          startedAt: new Date(startedAt.getTime() + i * 60_000),
          stoppedAt: new Date(startedAt.getTime() + i * 60_000 + 30_000),
        });
      }
      const compressed = await compressSessionChunks(90);
      expect(compressed.length).toBeGreaterThanOrEqual(1);

      await sweepStaleSessions();
      expect((await readSession(session.id))?.stoppedAt).toBeNull();

      const dbName = (
        (await db.execute(sql`SELECT current_database() AS db`)).rows[0] as { db: string }
      ).db;
      await db.execute(
        sql.raw(
          `ALTER DATABASE "${dbName}" SET timescaledb.max_tuples_decompressed_per_dml_transaction = 20`
        )
      );
      await recreatePool();
      try {
        await sweepStaleSessions({ includeCompressed: true });
      } finally {
        await db.execute(
          sql.raw(
            `ALTER DATABASE "${dbName}" RESET timescaledb.max_tuples_decompressed_per_dml_transaction`
          )
        );
        await recreatePool();
      }

      const row = await readSession(session.id);
      expect(row?.stoppedAt?.getTime()).toBe(lastSeenAt.getTime());
      expect(row?.durationMs).toBe(10 * 60_000);
    }
  );
});
