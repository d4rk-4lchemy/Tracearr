/**
 * Identity-aware plays aggregate integration test.
 *
 * user_media_plays_daily has one row per user, media, chain and UTC day. A chain
 * (COALESCE(reference_id, id)) is counted when any segment reaches the 120s play
 * gate; readers count distinct counted chain_ids, so a chain that crosses UTC
 * midnight is one play. media_plays_daily rolls the per-user cagg up to
 * per-media-day with a distinct-user count.
 *
 * Run with: pnpm --filter @tracearr/server test:integration mediaPlaysAggregate
 */

import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { resolveMediaForItem } from '../../src/services/library/mediaResolutionService.js';

const DAY_MS = 86_400_000;
// Midday UTC, well inside the refresh window
const BASE = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - 2 * DAY_MS + DAY_MS / 2);
const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

async function refresh() {
  await db.execute(
    sql`CALL refresh_continuous_aggregate('user_media_plays_daily'::regclass, NULL, NULL)`
  );
}

async function countedChains(serverUserId: string, mediaId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT chain_id) FILTER (WHERE counted)::int AS plays
    FROM user_media_plays_daily
    WHERE server_user_id = ${serverUserId} AND media_id = ${mediaId}
  `);
  return (result.rows[0] as { plays: number }).plays;
}

describe('identity-aware plays aggregates', () => {
  it('counts a chain once when any segment passes the gate, and not at all when none does', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser({ role: 'member' });
    const account = await createTestServerUser({ userId: user.id, serverId: server.id });

    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      serverId: server.id,
      ratingKey: 'rk-1',
    });

    // Chain A: long head plus long continuation, one play
    const chainA = await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-1',
      startedAt: at(0),
      durationMs: 1_800_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-1',
      startedAt: at(40 * 60_000),
      durationMs: 1_800_000,
      totalDurationMs: 7_200_000,
      referenceId: chainA.id,
    });
    // Chain B: 60 s head, 30 min continuation, one play (issue #1232)
    const chainB = await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-1',
      startedAt: at(2 * 60 * 60_000),
      durationMs: 60_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
      shortSession: true,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-1',
      startedAt: at(2 * 60 * 60_000 + 5 * 60_000),
      durationMs: 1_800_000,
      totalDurationMs: 7_200_000,
      referenceId: chainB.id,
    });
    // Chain C: lone 60 s poke, no play
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-1',
      startedAt: at(4 * 60 * 60_000),
      durationMs: 60_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
      shortSession: true,
    });

    await refresh();

    expect(await countedChains(account.id, mediaId)).toBe(2);

    const rowCount = await db.execute(sql`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE counted)::int AS counted_rows
      FROM user_media_plays_daily
      WHERE server_user_id = ${account.id} AND media_id = ${mediaId}
    `);
    expect(rowCount.rows[0]).toEqual({ n: 3, counted_rows: 2 });

    const mediaRows = await db.execute(sql`
      SELECT plays::int AS plays, unique_users::int AS unique_users
      FROM media_plays_daily
      WHERE server_id = ${server.id} AND media_id = ${mediaId}
    `);
    expect(mediaRows.rows).toHaveLength(1);
    expect(mediaRows.rows[0]).toEqual({ plays: 2, unique_users: 1 });
  });

  it('counts a chain that crosses UTC midnight once', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser({ role: 'member' });
    const account = await createTestServerUser({ userId: user.id, serverId: server.id });

    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 27208,
      title: 'Inception 4',
      year: 2010,
      serverId: server.id,
      ratingKey: 'rk-4',
    });

    // Head at 23:30 UTC, continuation at 00:30 UTC the next day, both over the gate
    const head = await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-4',
      startedAt: at(DAY_MS / 2 - 30 * 60_000),
      durationMs: 1_500_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId,
      ratingKey: 'rk-4',
      startedAt: at(DAY_MS / 2 + 30 * 60_000),
      durationMs: 1_500_000,
      totalDurationMs: 7_200_000,
      referenceId: head.id,
    });

    await refresh();

    const rows = await db.execute(sql`
      SELECT day, counted
      FROM user_media_plays_daily
      WHERE server_user_id = ${account.id} AND media_id = ${mediaId}
      ORDER BY day
    `);
    expect(rows.rows).toHaveLength(2);
    expect((rows.rows as { counted: boolean }[]).every((r) => r.counted)).toBe(true);
    expect(await countedChains(account.id, mediaId)).toBe(1);
  });

  it('tracks any_watched per user-media-day', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser({ role: 'member' });
    const account = await createTestServerUser({ userId: user.id, serverId: server.id });

    const watchedMediaId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 27206,
      title: 'Inception 2',
      year: 2010,
      serverId: server.id,
      ratingKey: 'rk-2',
    });
    const unwatchedMediaId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 27207,
      title: 'Inception 3',
      year: 2010,
      serverId: server.id,
      ratingKey: 'rk-3',
    });

    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId: watchedMediaId,
      ratingKey: 'rk-2',
      durationMs: 1_800_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
      watched: true,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: account.id,
      mediaId: unwatchedMediaId,
      ratingKey: 'rk-3',
      durationMs: 1_800_000,
      totalDurationMs: 7_200_000,
      referenceId: null,
      watched: false,
    });

    await db.execute(
      sql`CALL refresh_continuous_aggregate('user_media_plays_daily'::regclass, NULL, NULL)`
    );

    const watchedRows = await db.execute(sql`
      SELECT any_watched
      FROM user_media_plays_daily
      WHERE server_user_id = ${account.id} AND media_id = ${watchedMediaId}
    `);
    expect(watchedRows.rows).toHaveLength(1);
    expect((watchedRows.rows[0] as { any_watched: boolean }).any_watched).toBe(true);

    const unwatchedRows = await db.execute(sql`
      SELECT any_watched
      FROM user_media_plays_daily
      WHERE server_user_id = ${account.id} AND media_id = ${unwatchedMediaId}
    `);
    expect(unwatchedRows.rows).toHaveLength(1);
    expect((unwatchedRows.rows[0] as { any_watched: boolean }).any_watched).toBe(false);
  });
});
