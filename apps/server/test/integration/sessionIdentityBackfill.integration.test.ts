/**
 * Backfill of canonical media identity onto historical sessions.
 *
 * backfillSessionIdentityBatch stamps media_id and provider ids onto existing
 * sessions rows by joining library_items on (server_id, rating_key). It runs in
 * bounded batches and is resumable: sessions whose rating key has no resolvable
 * library item are excluded so they never re-select.
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- sessionIdentityBackfill
 */

import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
  createTestLibraryItem,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { resolveMediaForItem } from '../../src/services/library/mediaResolutionService.js';
import {
  backfillSessionIdentityBatch,
  hasStampableSessionsBefore,
  runSessionIdentityBackfillWalk,
} from '../../src/jobs/sessionIdentityBackfill.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe('session identity backfill', () => {
  it('backfills identity onto old sessions from library items', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: '2733',
      imdbId: 'tt0322259',
      mediaId,
    });
    await createTestSession({ serverId: server.id, serverUserId: su.id, ratingKey: '2733' });

    const { updated } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBe(1);

    const { rows } = await db.execute(
      sql`SELECT media_id, imdb_id FROM sessions WHERE rating_key = '2733'`
    );
    const row = rows[0] as { media_id: string; imdb_id: string };
    expect(row.media_id).toBe(mediaId);
    expect(row.imdb_id).toBe('tt0322259');
  });

  it('is resumable: second run finds nothing left', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: '2733',
      imdbId: 'tt0322259',
      mediaId,
    });
    await createTestSession({ serverId: server.id, serverUserId: su.id, ratingKey: '2733' });

    await backfillSessionIdentityBatch(1000);
    const { updated } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBe(0);
  });

  it('returns oldest as a real Date usable by refreshAggregates', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: '2733',
      imdbId: 'tt0322259',
      mediaId,
    });
    await createTestSession({ serverId: server.id, serverUserId: su.id, ratingKey: '2733' });

    const { updated, oldest } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBeGreaterThanOrEqual(1);
    expect(oldest).toBeInstanceOf(Date);
    expect(typeof oldest?.toISOString).toBe('function');
    expect(() => oldest?.toISOString()).not.toThrow();
  });

  it('leaves sessions whose rating key has no library item untouched', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    await createTestSession({ serverId: server.id, serverUserId: su.id, ratingKey: 'orphan-rk' });

    const { updated } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBe(0);

    const { rows } = await db.execute(
      sql`SELECT media_id FROM sessions WHERE rating_key = 'orphan-rk'`
    );
    expect((rows[0] as { media_id: string | null }).media_id).toBeNull();
  });

  it('does not stamp an episode session stored under a show rating key', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const showId = await resolveMediaForItem({
      mediaType: 'show',
      tvdbId: 81189,
      title: 'Breaking Bad',
      year: 2008,
      serverId: server.id,
      ratingKey: 'show-rk',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'show-rk',
      mediaType: 'show',
      tvdbId: 81189,
      mediaId: showId,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: su.id,
      mediaType: 'episode',
      ratingKey: 'show-rk',
    });

    const { updated } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBe(0);

    const { rows } = await db.execute(
      sql`SELECT media_id FROM sessions WHERE server_id = ${server.id}`
    );
    expect((rows[0] as { media_id: string | null }).media_id).toBeNull();
  });

  it('unlinks a session linked to a show media row and keeps it unlinked', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const showId = await resolveMediaForItem({
      mediaType: 'show',
      tvdbId: 81189,
      title: 'Breaking Bad',
      year: 2008,
      serverId: server.id,
      ratingKey: 'show-rk',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'show-rk',
      mediaType: 'show',
      tvdbId: 81189,
      mediaId: showId,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: su.id,
      mediaType: 'episode',
      ratingKey: 'show-rk',
      mediaId: showId,
      showMediaId: showId,
      imdbId: 'tt0903747',
      tmdbId: 1396,
      tvdbId: 81189,
    });

    const first = await backfillSessionIdentityBatch(1000);
    expect(first.updated).toBe(1);
    const second = await backfillSessionIdentityBatch(1000);
    expect(second.updated).toBe(0);

    const { rows } = await db.execute(sql`
      SELECT media_id, show_media_id, imdb_id, tmdb_id, tvdb_id
      FROM sessions WHERE server_id = ${server.id}
    `);
    expect(rows[0]).toEqual({
      media_id: null,
      show_media_id: null,
      imdb_id: null,
      tmdb_id: null,
      tvdb_id: null,
    });
  });

  it('does not stamp a movie library item whose media row is a show', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const showId = await resolveMediaForItem({
      mediaType: 'show',
      tvdbId: 81189,
      title: 'Breaking Bad',
      year: 2008,
      serverId: server.id,
      ratingKey: 'reused-rk',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'reused-rk',
      mediaType: 'movie',
      mediaId: showId,
    });
    await createTestSession({ serverId: server.id, serverUserId: su.id, ratingKey: 'reused-rk' });

    await backfillSessionIdentityBatch(1000);
    const second = await backfillSessionIdentityBatch(1000);
    expect(second.updated).toBe(0);

    const { rows } = await db.execute(
      sql`SELECT media_id FROM sessions WHERE server_id = ${server.id}`
    );
    expect((rows[0] as { media_id: string | null }).media_id).toBeNull();
  });

  it('still stamps a Jellyfin unknown session played from a movie library item', async () => {
    const server = await createTestServer({ type: 'jellyfin' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: 'jf-movie',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'jf-movie',
      mediaType: 'movie',
      imdbId: 'tt0322259',
      mediaId,
    });
    await createTestSession({
      serverId: server.id,
      serverUserId: su.id,
      mediaType: 'unknown',
      ratingKey: 'jf-movie',
    });

    const { updated } = await backfillSessionIdentityBatch(1000);
    expect(updated).toBe(1);

    const { rows } = await db.execute(
      sql`SELECT media_id FROM sessions WHERE server_id = ${server.id}`
    );
    expect((rows[0] as { media_id: string | null }).media_id).toBe(mediaId);
  });

  it('continues below the previous batch instead of re-reading the rows above it', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    await createTestLibraryItem({ serverId: server.id, ratingKey: '2733', mediaId });
    for (const days of [1, 2, 3]) {
      await createTestSession({
        serverId: server.id,
        serverUserId: su.id,
        ratingKey: '2733',
        startedAt: daysAgo(days),
      });
    }

    const first = await backfillSessionIdentityBatch(2);
    expect(first.updated).toBe(2);
    // A row above the cursor that matches again is left for the next walk.
    await db.execute(sql`
      UPDATE sessions SET media_id = NULL
      WHERE server_id = ${server.id} AND started_at = (
        SELECT max(started_at) FROM sessions WHERE server_id = ${server.id}
      )
    `);

    const second = await backfillSessionIdentityBatch(2, undefined, first.cursor);
    expect(second.updated).toBe(1);
    expect(second.cursor).toEqual([null, null, null]);
    const { rows } = await db.execute(sql`
      SELECT media_id FROM sessions WHERE server_id = ${server.id} ORDER BY started_at DESC
    `);
    expect(rows.map((r) => (r as { media_id: string | null }).media_id)).toEqual([
      null,
      mediaId,
      mediaId,
    ]);
  });

  it('stamps a row the unlink pass freed above where the fresh stamp stopped', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const movieId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    const showId = await resolveMediaForItem({
      mediaType: 'show',
      tvdbId: 81189,
      title: 'Breaking Bad',
      year: 2008,
      serverId: server.id,
      ratingKey: 'show-rk',
    });
    await createTestLibraryItem({ serverId: server.id, ratingKey: '2733', mediaId: movieId });
    // Newest, and linked to a container: only the unlink pass can free it for
    // a fresh stamp, after the fresh pass of the same batch has already run.
    await createTestSession({
      serverId: server.id,
      serverUserId: su.id,
      ratingKey: '2733',
      mediaId: showId,
      startedAt: daysAgo(1),
    });
    for (const days of [2, 3]) {
      await createTestSession({
        serverId: server.id,
        serverUserId: su.id,
        ratingKey: '2733',
        startedAt: daysAgo(days),
      });
    }

    await runSessionIdentityBackfillWalk({
      batchSize: 1,
      getCompressedRanges: async () => [],
      getChunkRanges: async () => [],
    });

    const { rows } = await db.execute(
      sql`SELECT media_id FROM sessions WHERE server_id = ${server.id}`
    );
    expect(rows.map((r) => (r as { media_id: string | null }).media_id)).toEqual([
      movieId,
      movieId,
      movieId,
    ]);
  });

  it('probes only the rating keys it is given', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await createTestUser();
    const su = await createTestServerUser({ userId: user.id, serverId: server.id });
    const mediaId = await resolveMediaForItem({
      mediaType: 'movie',
      imdbId: 'tt0322259',
      title: '2 Fast 2 Furious',
      year: 2003,
      serverId: server.id,
      ratingKey: '2733',
    });
    await createTestLibraryItem({ serverId: server.id, ratingKey: '2733', mediaId });
    await createTestSession({
      serverId: server.id,
      serverUserId: su.id,
      ratingKey: '2733',
      startedAt: daysAgo(2),
    });

    await expect(hasStampableSessionsBefore(new Date(), server.id, ['other-rk'])).resolves.toBe(
      false
    );
    await expect(hasStampableSessionsBefore(new Date(), server.id, ['2733'])).resolves.toBe(true);
  });
});
