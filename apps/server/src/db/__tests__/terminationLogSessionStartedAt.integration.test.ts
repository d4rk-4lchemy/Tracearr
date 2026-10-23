import { readFileSync, readdirSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createTestServer,
  createTestServerUser,
  createTestSession,
  createTestUser,
} from '@tracearr/test-utils/factories';
import { db } from '../client.js';
import { sessions, terminationLogs } from '../schema.js';

const MIGRATIONS = `${import.meta.dirname}/../migrations`;

function statementsOf(): string[] {
  const file = readdirSync(MIGRATIONS).find((name) => /^0119_.*\.sql$/.test(name));
  if (!file) throw new Error('migration 0119 not found');
  return readFileSync(`${MIGRATIONS}/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Mirrors how drizzle applies a breakpoints file: one execute per statement. */
async function apply(statements: string[]): Promise<void> {
  for (const statement of statements) await db.execute(sql.raw(statement));
}

describe('migration 0119 termination_logs.session_started_at', () => {
  it('fills the column from each session and leaves it null where the session is gone', async () => {
    const server = await createTestServer();
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });
    const base = { serverId: server.id, serverUserId: serverUser.id };
    const kept = await createTestSession({ ...base, startedAt: new Date('2025-03-01T10:00:00Z') });
    const gone = await createTestSession({ ...base, startedAt: new Date('2025-03-02T10:00:00Z') });
    const log = { serverId: server.id, serverUserId: serverUser.id, trigger: 'manual' as const };
    await db.insert(terminationLogs).values([
      { ...log, sessionId: kept.id, success: true },
      { ...log, sessionId: gone.id, success: false, errorMessage: 'nope' },
    ]);
    await db.delete(sessions).where(eq(sessions.id, gone.id));

    await db.execute(sql`ALTER TABLE termination_logs DROP COLUMN session_started_at`);
    try {
      await apply(statementsOf());
    } finally {
      // Other files in this worker share the table, so a throw above must not leave the column off.
      await db.execute(
        sql`ALTER TABLE termination_logs ADD COLUMN IF NOT EXISTS session_started_at timestamptz`
      );
    }

    const rows = await db
      .select({ sessionId: terminationLogs.sessionId, startedAt: terminationLogs.sessionStartedAt })
      .from(terminationLogs);
    const startedAt = Object.fromEntries(rows.map((r) => [r.sessionId, r.startedAt]));
    expect(startedAt[kept.id]).toEqual(kept.startedAt);
    expect(startedAt[gone.id]).toBeNull();
  });
});
