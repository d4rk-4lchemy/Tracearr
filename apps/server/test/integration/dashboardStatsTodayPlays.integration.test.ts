/**
 * Dashboard "today's plays" sargability fix integration tests
 *
 * dashboardStats.ts used to filter "today" with
 * `(started_at AT TIME ZONE tz)::date = (NOW() AT TIME ZONE tz)::date`, which
 * cannot use the started_at index/chunk exclusion (it wraps started_at in an
 * expression), so every chunk had to be scanned. It was replaced with a
 * sargable `started_at >= todayStart AND started_at < todayStart + interval
 * '1 day'` range using the same todayStart already computed for the rest of
 * the function. This file confirms the rewrite keeps identical semantics,
 * including across a day boundary in a non-UTC timezone.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { getDashboardStats } from '../../src/services/dashboardStats.js';
import { initPreparedStatements } from '../../src/db/prepared.js';
import { getStartOfDayInTimezone } from '../../src/routes/stats/utils.js';
import { MEDIA_TYPE_SQL_FILTER } from '../../src/constants/index.js';

const MIN_PLAY_DURATION_MS = 120_000;

/** Reproduces the old (pre-fix) non-sargable "today" semantics directly, so the
 * rewritten query can be checked against it without needing the old code path. */
async function oldSemanticsTodayPlaysCount(timezone: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(reference_id, id))::int as count
    FROM sessions
    WHERE (started_at AT TIME ZONE ${timezone})::date = (NOW() AT TIME ZONE ${timezone})::date
      AND duration_ms >= ${MIN_PLAY_DURATION_MS}
      ${MEDIA_TYPE_SQL_FILTER}
  `);
  return (result.rows[0] as { count: number } | undefined)?.count ?? 0;
}

describe('dashboard stats: today plays across a day boundary (non-UTC timezone)', () => {
  beforeAll(() => {
    // The no-server-filter branch uses prepared statements, normally created
    // by server startup - initialize them here for the test process.
    initPreparedStatements();
  });

  it('matches the old AT TIME ZONE semantics for both the all-servers and server-filtered branches', async () => {
    // Fixed-offset zone (no DST) so the boundary math is deterministic.
    const timezone = 'Etc/GMT+5'; // UTC-5, POSIX sign is inverted
    const todayStart = getStartOfDayInTimezone(timezone);

    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });

    const sessionDefaults = {
      serverId: server.id,
      serverUserId: serverUser.id,
      mediaType: 'movie' as const,
      durationMs: MIN_PLAY_DURATION_MS + 60_000,
      totalDurationMs: 7_200_000,
    };

    // Just after local midnight today - should count.
    await createTestSession({
      ...sessionDefaults,
      startedAt: new Date(todayStart.getTime() + 60_000),
    });
    // Later today - should count.
    await createTestSession({
      ...sessionDefaults,
      startedAt: new Date(todayStart.getTime() + 20 * 60 * 60 * 1000),
    });
    // Just before local midnight today (i.e. yesterday) - must NOT count.
    await createTestSession({
      ...sessionDefaults,
      startedAt: new Date(todayStart.getTime() - 60_000),
    });
    // Several days further back - must NOT count. Also spreads sessions
    // across multiple weekly hypertable chunks (chunk_time_interval='7 days'),
    // which is what makes the sargable rewrite's chunk exclusion matter.
    for (const daysAgo of [3, 10, 20, 40]) {
      await createTestSession({
        ...sessionDefaults,
        startedAt: new Date(todayStart.getTime() - daysAgo * 24 * 60 * 60 * 1000),
      });
    }
    // Below the minimum play duration - must NOT count even though it's today.
    await createTestSession({
      ...sessionDefaults,
      startedAt: new Date(todayStart.getTime() + 5 * 60 * 60 * 1000),
      durationMs: 5_000,
    });

    const expectedOldSemantics = await oldSemanticsTodayPlaysCount(timezone);
    expect(expectedOldSemantics).toBe(2);

    const allServersStats = await getDashboardStats({ serverIds: undefined, timezone });
    expect(allServersStats.todayPlays).toBe(expectedOldSemantics);

    const filteredStats = await getDashboardStats({ serverIds: [server.id], timezone });
    expect(filteredStats.todayPlays).toBe(expectedOldSemantics);
  });

  it('keeps VOD metrics separate from TV metrics while counting live sessions in active users', async () => {
    const timezone = 'UTC';
    const todayStart = getStartOfDayInTimezone(timezone);

    const server = await createTestServer({ type: 'dispatcharr' });
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });

    await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      mediaType: 'live',
      startedAt: new Date(todayStart.getTime() + 10 * 60 * 1000),
      durationMs: 30 * 60 * 1000,
      totalDurationMs: 30 * 60 * 1000,
    });

    const stats = await getDashboardStats({ serverIds: [server.id], timezone });
    expect(stats.todayPlays).toBe(0);
    expect(stats.todaySessions).toBe(0);
    expect(stats.watchTimeHours).toBe(0);
    expect(stats.tvSessions).toBe(1);
    expect(stats.tvWatchTimeHours).toBe(0.5);
    expect(stats.activeUsersToday).toBe(1);
  });

  it('uses effective live watch time when durationMs is still null', async () => {
    const timezone = 'UTC';
    const todayStart = getStartOfDayInTimezone(timezone);

    const server = await createTestServer({ type: 'dispatcharr' });
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });

    const startedAt = new Date(todayStart.getTime() + 60 * 60 * 1000);
    const stoppedAt = new Date(startedAt.getTime() + 2 * 60 * 60 * 1000);

    await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      mediaType: 'live',
      startedAt,
      stoppedAt,
      durationMs: null,
      pausedDurationMs: 0,
      totalDurationMs: 0,
    });

    const stats = await getDashboardStats({ serverIds: [server.id], timezone });
    expect(stats.tvSessions).toBe(1);
    expect(stats.tvWatchTimeHours).toBe(2);
  });

  it('matches history-style grouped live watch time in the all-servers branch', async () => {
    const timezone = 'UTC';
    const todayStart = getStartOfDayInTimezone(timezone);

    const server = await createTestServer({ type: 'dispatcharr' });
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });
    const referenceId = crypto.randomUUID();

    await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      referenceId,
      mediaType: 'live',
      startedAt: new Date(todayStart.getTime() + 60 * 60 * 1000),
      stoppedAt: new Date(todayStart.getTime() + 90 * 60 * 1000),
      durationMs: 30 * 60 * 1000,
      pausedDurationMs: 0,
      totalDurationMs: 0,
    });

    await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      referenceId,
      mediaType: 'live',
      startedAt: new Date(todayStart.getTime() + 90 * 60 * 1000),
      stoppedAt: new Date(todayStart.getTime() + 150 * 60 * 1000),
      durationMs: null,
      pausedDurationMs: 0,
      totalDurationMs: 0,
    });

    const stats = await getDashboardStats({ serverIds: undefined, timezone });
    expect(stats.tvSessions).toBeGreaterThanOrEqual(1);
    expect(stats.tvWatchTimeHours).toBeGreaterThanOrEqual(1.5);
  });

  it('reads the live watch time aggregate from the raw SQL alias shape used by postgres', async () => {
    const timezone = 'UTC';
    const todayStart = getStartOfDayInTimezone(timezone);

    const server = await createTestServer({ type: 'dispatcharr' });
    const user = await createTestUser();
    const serverUser = await createTestServerUser({ serverId: server.id, userId: user.id });

    await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      mediaType: 'live',
      startedAt: new Date(todayStart.getTime() + 30 * 60 * 1000),
      stoppedAt: new Date(todayStart.getTime() + 120 * 60 * 1000),
      durationMs: 90 * 60 * 1000,
      pausedDurationMs: 0,
      totalDurationMs: 0,
    });

    const stats = await getDashboardStats({ serverIds: [server.id], timezone });
    expect(stats.tvWatchTimeHours).toBe(1.5);
  });
});
