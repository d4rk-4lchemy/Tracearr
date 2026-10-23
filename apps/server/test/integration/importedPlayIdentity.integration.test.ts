/**
 * Imported plays get media identity through the library resolver: at insert, and for rows
 * imported before that through the session identity backfill.
 *
 * Run with: pnpm --filter @tracearr/server test:integration importedPlayIdentity
 */

import { describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
  createTestLibraryItem,
} from '@tracearr/test-utils/factories';
import { db, recreatePool } from '../../src/db/client.js';
import { media } from '../../src/db/schema.js';
import { getCompressedSessionChunkRanges, getSessionChunkRanges } from '../../src/db/timescale.js';
import { runSessionIdentityBackfillWalk } from '../../src/jobs/sessionIdentityBackfill.js';
import { buildWatchSummaryQuery } from '../../src/routes/library/watch.js';
import { resolveLibraryWindow } from '../../src/routes/library/utils.js';
import { flushInsertBatch, type NewSession } from '../../src/services/import/batchProcessor.js';
import { resolveImportedPlays } from '../../src/services/library/importedPlayIdentity.js';
import { getMediaStats } from '../../src/services/library/mediaDetailService.js';
import {
  mergeMediaRows,
  reconcileMediaDuplicates,
  resolveMediaBatch,
  resolveMediaForItem,
} from '../../src/services/library/mediaResolutionService.js';
import { stampPendingSessionIdentity } from '../../src/services/librarySync.js';
import { compressSessionChunks } from '../../src/test/compressChunks.js';
import * as producers from '../../src/services/automations/events/producers.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TODAY = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const daysAgo = (days: number) => new Date(TODAY - days * DAY_MS + DAY_MS / 2);

let importCounter = 0;

async function account(serverId: string): Promise<string> {
  const user = await createTestUser({ role: 'member' });
  return (await createTestServerUser({ userId: user.id, serverId })).id;
}

async function libraryMovie(serverId: string, ratingKey: string, title: string, year: number) {
  const mediaId = await resolveMediaForItem({
    mediaType: 'movie',
    tmdbId: 90_000 + importCounter++,
    title,
    year,
    serverId,
    ratingKey,
  });
  await createTestLibraryItem({ serverId, ratingKey, title, year, mediaType: 'movie', mediaId });
  return mediaId;
}

async function libraryShow(serverId: string, ratingKey: string, title: string, year: number) {
  const showId = await resolveMediaForItem({
    mediaType: 'show',
    tvdbId: 80_000 + importCounter++,
    title,
    year,
    serverId,
    ratingKey,
  });
  await createTestLibraryItem({
    serverId,
    ratingKey,
    title,
    year,
    mediaType: 'show',
    mediaId: showId,
    withoutVersion: true,
  });
  return showId;
}

async function libraryEpisode(
  serverId: string,
  show: { id: string; ratingKey: string },
  season: number,
  episode: number
) {
  const ratingKey = `${show.ratingKey}-s${season}e${episode}`;
  const mediaId = await resolveMediaForItem({
    mediaType: 'episode',
    tvdbId: 70_000 + importCounter++,
    title: `Episode ${episode}`,
    serverId,
    ratingKey,
    showMediaId: show.id,
    seasonNumber: season,
    episodeNumber: episode,
  });
  await createTestLibraryItem({
    serverId,
    ratingKey,
    title: `Episode ${episode}`,
    mediaType: 'episode',
    grandparentRatingKey: show.ratingKey,
    parentIndex: season,
    itemIndex: episode,
    mediaId,
  });
  return mediaId;
}

function importedRow(
  serverId: string,
  serverUserId: string,
  fields: Partial<Omit<NewSession, 'ipAddress'>> & { mediaTitle: string }
): NewSession {
  const id = `import-${importCounter++}`;
  return {
    serverId,
    serverUserId,
    sessionKey: id,
    externalSessionId: id,
    ratingKey: `gone-${id}`,
    ipAddress: '10.0.0.9',
    state: 'stopped',
    mediaType: 'movie',
    startedAt: daysAgo(1),
    lastSeenAt: daysAgo(1),
    durationMs: 2 * HOUR_MS,
    totalDurationMs: 2 * HOUR_MS,
    ...fields,
  };
}

async function importPlays(rows: NewSession[]) {
  await flushInsertBatch(rows);
  const result = await db.execute(sql`
    SELECT external_session_id, media_id, show_media_id FROM sessions
    WHERE external_session_id = ANY(${sql.param(rows.map((r) => r.externalSessionId))}::text[])
  `);
  const byId = new Map(
    (
      result.rows as Array<{
        external_session_id: string;
        media_id: string | null;
        show_media_id: string | null;
      }>
    ).map((r) => [r.external_session_id, r])
  );
  return rows.map((r) => byId.get(r.externalSessionId ?? ''));
}

async function mediaRows(type: string, title: string) {
  return (
    await db.execute(
      sql`SELECT id, year, show_media_id FROM media WHERE media_type = ${type} AND title = ${title} AND merged_into_id IS NULL ORDER BY created_at`
    )
  ).rows as Array<{ id: string; year: number | null; show_media_id: string | null }>;
}

async function refreshPlays() {
  await db.execute(
    sql`CALL refresh_continuous_aggregate('user_media_plays_daily'::regclass, NULL, NULL)`
  );
}

describe('imported play identity at insert', () => {
  it('links an import of a title the library holds to the library item media row, under a dead rating key', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const movieId = await libraryMovie(server.id, 'rk-current', 'Quiet Harbor', 2020);

    const [row] = await importPlays([
      importedRow(server.id, user, { mediaTitle: 'Quiet Harbor', year: 2020 }),
    ]);

    expect(row).toMatchObject({ media_id: movieId, show_media_id: null });
    expect(await mediaRows('movie', 'Quiet Harbor')).toHaveLength(1);
  });

  it('gives an import of a title the library never held its own media row that every reader counts', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);

    const [row] = await importPlays([
      importedRow(server.id, user, { mediaTitle: 'Lantern Road', year: 1998 }),
    ]);
    const rows = await mediaRows('movie', 'Lantern Road');
    expect(rows).toHaveLength(1);
    expect(row?.media_id).toBe(rows[0]?.id);
    await refreshPlays();

    const window = resolveLibraryWindow({ period: '30d' });
    const watch = (
      await db.execute(
        buildWatchSummaryQuery({ window, serverIds: undefined, libraryId: undefined })
      )
    ).rows[0] as { total_plays: string; total_watch_ms: string };
    expect([Number(watch.total_plays), Number(watch.total_watch_ms)]).toEqual([0, 0]);
    const stats = await getMediaStats(
      { kind: 'media', aliases: [rows[0]?.id], seasonNumber: null, showAliases: [] },
      undefined,
      'all'
    );
    expect(stats.last_30.combined).toMatchObject({ plays: 1, watch_time_ms: 2 * HOUR_MS });
  });

  it('attaches imported episodes to the existing show by title, with the session year being the episode year', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const showId = await libraryShow(server.id, 'rk-threads', 'Loose Threads', 2015);
    const episodeId = await libraryEpisode(
      server.id,
      { id: showId, ratingKey: 'rk-threads' },
      1,
      3
    );

    const [inLibrary, notInLibrary] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Episode 3',
        grandparentTitle: 'Loose Threads',
        seasonNumber: 1,
        episodeNumber: 3,
        year: 2024,
      }),
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Episode 1',
        grandparentTitle: 'Loose Threads',
        seasonNumber: 2,
        episodeNumber: 1,
        year: 2024,
      }),
    ]);

    expect(inLibrary).toMatchObject({ media_id: episodeId, show_media_id: showId });
    expect(notInLibrary?.show_media_id).toBe(showId);
    expect(notInLibrary?.media_id).not.toBeNull();
    expect(notInLibrary?.media_id).not.toBe(episodeId);
    expect(await mediaRows('show', 'Loose Threads')).toHaveLength(1);
    const [created] = (
      await db.execute(
        sql`SELECT match_key FROM media WHERE id = ${notInLibrary?.media_id ?? ''}::uuid`
      )
    ).rows as Array<{ match_key: string }>;
    expect(created?.match_key).toBe(`episode:${showId}:s2e1`);
  });

  it('attaches an import naming the show with a year suffix to the library show without one', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const showId = await libraryShow(server.id, 'rk-lights', 'Harbor Lights', 2021);

    const [row] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Harbor Lights (2021)',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2021,
      }),
    ]);

    expect(row?.show_media_id).toBe(showId);
    expect(await mediaRows('show', 'Harbor Lights')).toHaveLength(1);
    expect(await mediaRows('show', 'Harbor Lights (2021)')).toHaveLength(0);
  });

  it('creates a show from a year-suffixed import title with the suffix as its year, so a later sync shares it', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);

    const [row] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Salt Marsh (2019)',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2024,
      }),
    ]);
    const created = await mediaRows('show', 'Salt Marsh');
    expect(created).toEqual([expect.objectContaining({ year: 2019 })]);
    expect(row?.show_media_id).toBe(created[0]?.id);

    const synced = await libraryShow(server.id, 'rk-marsh', 'Salt Marsh', 2019);
    expect(synced).toBe(created[0]?.id);
  });

  it('creates the show for an imported episode of a show the library never held, once', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);

    const rows = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Salt Road',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2019,
      }),
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Salt Road',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2019,
      }),
    ]);
    const shows = await mediaRows('show', 'Salt Road');
    expect(shows).toHaveLength(1);
    for (const row of rows) {
      expect(row?.show_media_id).toBe(shows[0]?.id);
    }
    expect(rows[0]?.media_id).toBe(rows[1]?.media_id);
  });

  it('leaves an imported episode unlinked when two known shows share its title', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    await libraryShow(server.id, 'rk-twin-1', 'Twin Peaks Road', 1990);
    await libraryShow(server.id, 'rk-twin-2', 'Twin Peaks Road', 2017);

    const play = {
      serverId: server.id,
      mediaType: 'episode' as const,
      mediaTitle: 'Pilot',
      grandparentTitle: 'Twin Peaks Road',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const resolution = await resolveImportedPlays([play]);
    expect(resolution.identities.size).toBe(0);
    expect(resolution.ambiguousShows).toBe(1);

    const [row] = await importPlays([importedRow(server.id, user, play)]);
    expect(row).toMatchObject({ media_id: null, show_media_id: null });
    expect(await mediaRows('show', 'Twin Peaks Road')).toHaveLength(2);
  });

  it('never cross-links an import whose dead rating key a current item reuses', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const otherId = await libraryMovie(server.id, 'rk-7', 'Other Film', 2010);

    const [row] = await importPlays([
      importedRow(server.id, user, { ratingKey: 'rk-7', mediaTitle: 'Gone Film', year: 2001 }),
    ]);

    expect(row?.media_id).not.toBe(otherId);
    const gone = await mediaRows('movie', 'Gone Film');
    expect(gone).toHaveLength(1);
    expect(row?.media_id).toBe(gone[0]?.id);
    const items = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM library_items WHERE rating_key LIKE 'import:%'`
    );
    expect((items.rows[0] as { n: number }).n).toBe(0);
  });
});

describe('imported play identity for rows imported earlier', () => {
  it('resolves an unlinked import at the sync tail and lands it in the materialized rollup', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const movieId = await libraryMovie(server.id, 'rk-late', 'Late Harbor', 2020);
    await createTestSession({
      serverId: server.id,
      serverUserId: user,
      mediaId: null,
      mediaType: 'movie',
      mediaTitle: 'Late Harbor',
      year: 2020,
      ratingKey: 'rk-gone',
      externalSessionId: 'late-1',
      startedAt: daysAgo(10),
      durationMs: 2 * HOUR_MS,
      totalDurationMs: 2 * HOUR_MS,
      referenceId: null,
    });
    await refreshPlays();
    const materialized = async () => {
      const [table] = (
        await db.execute(sql`
          SELECT format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name) AS t
          FROM timescaledb_information.continuous_aggregates WHERE view_name = 'user_media_plays_daily'
        `)
      ).rows as Array<{ t: string }>;
      const rows = (
        await db.execute(
          sql`SELECT COUNT(*)::int AS n FROM ${sql.raw(table?.t ?? '')} WHERE media_id = ${movieId}::uuid`
        )
      ).rows as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    };
    expect(await materialized()).toBe(0);

    await stampPendingSessionIdentity(false);

    const [row] = (
      await db.execute(sql`SELECT media_id FROM sessions WHERE external_session_id = 'late-1'`)
    ).rows as Array<{ media_id: string | null }>;
    expect(row?.media_id).toBe(movieId);
    expect(await materialized()).toBe(1);
  });

  it(
    'resolves unlinked imports inside a compressed chunk through the maintenance walk',
    { timeout: 120_000 },
    async () => {
      const server = await createTestServer({ type: 'plex' });
      const user = await account(server.id);
      const chunkAgeDays = 120;
      const base = new Date(TODAY - chunkAgeDays * DAY_MS + DAY_MS / 2);
      const [existing] = await db
        .insert(media)
        .values({
          mediaType: 'movie',
          matchKey: `movie:title:oldharbor:1999`,
          title: 'Old Harbor',
          normalizedTitle: 'oldharbor',
          year: 1999,
        })
        .returning({ id: media.id });
      for (let i = 0; i < 40; i++) {
        await createTestSession({
          serverId: server.id,
          serverUserId: user,
          mediaId: null,
          mediaType: 'movie',
          mediaTitle: i % 2 === 0 ? 'Old Harbor' : 'Fresh Harbor',
          year: 1999,
          ratingKey: `rk-old-${i}`,
          externalSessionId: `old-${i}`,
          startedAt: new Date(base.getTime() + i * 60_000),
          durationMs: HOUR_MS,
          totalDurationMs: 2 * HOUR_MS,
          referenceId: null,
        });
      }
      const compressed = await compressSessionChunks(chunkAgeDays - 30);
      expect(compressed.length).toBeGreaterThanOrEqual(1);
      await recreatePool();

      const startedAt = Date.now();
      const result = await runSessionIdentityBackfillWalk({
        batchSize: 10,
        getCompressedRanges: getCompressedSessionChunkRanges,
        getChunkRanges: getSessionChunkRanges,
      });
      const elapsedMs = Date.now() - startedAt;
      expect(result.failedRanges).toEqual([]);
      expect(result.total).toBe(40);
      console.log(`[importedPlayIdentity] compressed walk of 40 imports: ${elapsedMs} ms`);

      const rows = (
        await db.execute(sql`
          SELECT media_title, COUNT(DISTINCT media_id)::int AS ids, COUNT(*) FILTER (WHERE media_id IS NULL)::int AS unlinked
          FROM sessions WHERE external_session_id LIKE 'old-%' GROUP BY media_title ORDER BY media_title
        `)
      ).rows as Array<{ media_title: string; ids: number; unlinked: number }>;
      expect(rows).toEqual([
        { media_title: 'Fresh Harbor', ids: 1, unlinked: 0 },
        { media_title: 'Old Harbor', ids: 1, unlinked: 0 },
      ]);
      const [old] = (
        await db.execute(
          sql`SELECT DISTINCT media_id FROM sessions WHERE media_title = 'Old Harbor' AND external_session_id LIKE 'old-%'`
        )
      ).rows as Array<{ media_id: string }>;
      expect(old?.media_id).toBe(existing?.id);
    }
  );

  it('writes only media_id and show_media_id, only where they were null, across insert-time resolution and the walk', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const harborId = await libraryMovie(server.id, 'rk-harbor', 'Quiet Harbor', 2020);
    await libraryMovie(server.id, 'rk-reused', 'Other Film', 2010);
    const showId = await libraryShow(server.id, 'rk-threads', 'Loose Threads', 2015);
    await libraryEpisode(server.id, { id: showId, ratingKey: 'rk-threads' }, 1, 3);

    const inserted = await importPlays([
      importedRow(server.id, user, {
        mediaTitle: 'Quiet Harbor',
        year: 2020,
        imdbId: 'tt0000001',
      }),
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Episode 3',
        grandparentTitle: 'Loose Threads',
        seasonNumber: 1,
        episodeNumber: 3,
        year: 2024,
        parentRatingKey: 'rk-old-season',
        grandparentRatingKey: 'rk-old-show',
      }),
    ]);
    expect(inserted.map((r) => r?.media_id)).toEqual([harborId, expect.any(String)]);

    const before = async () => {
      const result = await db.execute(sql`
        SELECT row_to_json(s) AS row FROM sessions s
        WHERE s.server_id = ${server.id}::uuid ORDER BY s.started_at, s.id
      `);
      return (result.rows as Array<{ row: Record<string, unknown> }>).map((r) => r.row);
    };
    const tracked = await createTestSession({
      serverId: server.id,
      serverUserId: user,
      externalSessionId: null,
      mediaId: null,
      ratingKey: 'rk-harbor',
      mediaTitle: 'Quiet Harbor',
      year: 2020,
      imdbId: 'tt0000009',
      startedAt: daysAgo(3),
    });
    const reused = await createTestSession({
      serverId: server.id,
      serverUserId: user,
      externalSessionId: 'reused-1',
      mediaId: null,
      ratingKey: 'rk-reused',
      mediaTitle: 'Gone Film',
      year: 2001,
      imdbId: 'tt0000002',
      startedAt: daysAgo(4),
    });
    const snapshot = await before();

    await runSessionIdentityBackfillWalk({
      batchSize: 100,
      getCompressedRanges: getCompressedSessionChunkRanges,
      getChunkRanges: getSessionChunkRanges,
    });

    const after = await before();
    expect(after.map((r) => r.id)).toEqual(snapshot.map((r) => r.id));
    snapshot.forEach((was, i) => {
      const now = after[i];
      expect(now).toBeDefined();
      if (!now) return;
      for (const column of Object.keys(was)) {
        if (column === 'media_id' || column === 'show_media_id') {
          if (was[column] !== null) expect(now[column]).toBe(was[column]);
        } else {
          expect(now[column]).toEqual(was[column]);
        }
      }
    });
    const byId = new Map(after.map((r) => [r.id as string, r]));
    expect(byId.get(tracked.id)).toMatchObject({ media_id: harborId, imdb_id: 'tt0000009' });
    const gone = await mediaRows('movie', 'Gone Film');
    expect(byId.get(reused.id)).toMatchObject({
      media_id: gone[0]?.id,
      imdb_id: 'tt0000002',
      rating_key: 'rk-reused',
    });
  });
});

describe('imported play identity against the library resolver', () => {
  it('adopts a stylized history title onto the show its earlier plays already sit on', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const showId = await libraryShow(server.id, 'rk-lights', 'Harbor Lights', 2021);
    const episodeId = await libraryEpisode(server.id, { id: showId, ratingKey: 'rk-lights' }, 1, 1);
    await createTestSession({
      serverId: server.id,
      serverUserId: user,
      externalSessionId: null,
      mediaId: episodeId,
      showMediaId: showId,
      mediaType: 'episode',
      mediaTitle: 'Pilot',
      grandparentTitle: 'HARB0R L1GHTS',
      ratingKey: 'rk-lights-s1e1',
      startedAt: daysAgo(5),
    });

    const [row] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Second',
        grandparentTitle: 'HARB0R L1GHTS',
        seasonNumber: 1,
        episodeNumber: 2,
        year: 2022,
      }),
    ]);

    expect(row?.show_media_id).toBe(showId);
    expect(await mediaRows('show', 'HARB0R L1GHTS')).toHaveLength(0);
  });

  it('refuses the library remake for plays that aired before it premiered and keeps later plays on it', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const remakeId = await libraryShow(server.id, 'rk-remake', 'Twin Roads', 2017);

    const [old, recent] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Twin Roads',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 1990,
      }),
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Twin Roads',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2017,
      }),
    ]);

    expect(recent?.show_media_id).toBe(remakeId);
    expect(old?.show_media_id).not.toBeNull();
    expect(old?.show_media_id).not.toBe(remakeId);
    const [later] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Second',
        grandparentTitle: 'Twin Roads',
        seasonNumber: 1,
        episodeNumber: 2,
        year: 2018,
      }),
    ]);
    expect(later?.show_media_id).toBe(remakeId);
  });

  it('creates no show for plays that cannot attach to one', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const [row] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Numberless Road',
        seasonNumber: null,
        episodeNumber: null,
      }),
    ]);
    expect(row?.media_id).toBeNull();
    expect(await mediaRows('show', 'Numberless Road')).toHaveLength(0);
  });

  it('lets a later library sync with a provider id adopt the episode row an import created, and refuses one whose title differs', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const showId = await libraryShow(server.id, 'rk-early', 'Early Harbor', 2020);
    const [first, second] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Early Harbor',
        seasonNumber: 1,
        episodeNumber: 1,
      }),
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Second',
        grandparentTitle: 'Early Harbor',
        seasonNumber: 1,
        episodeNumber: 2,
      }),
    ]);

    const synced = await resolveMediaForItem({
      mediaType: 'episode',
      tvdbId: 71_101,
      title: 'Pilot',
      serverId: server.id,
      ratingKey: 'rk-early-s1e1',
      showMediaId: showId,
      seasonNumber: 1,
      episodeNumber: 1,
    });
    expect(synced).toBe(first?.media_id);
    const [adopted] = (
      await db.execute(sql`SELECT tvdb_id, match_key FROM media WHERE id = ${synced}::uuid`)
    ).rows as Array<{ tvdb_id: number; match_key: string }>;
    expect(adopted).toEqual({ tvdb_id: 71_101, match_key: `episode:${showId}:s1e1` });

    const renumbered = await resolveMediaForItem({
      mediaType: 'episode',
      tvdbId: 71_102,
      title: 'A Different Episode',
      serverId: server.id,
      ratingKey: 'rk-early-s1e2',
      showMediaId: showId,
      seasonNumber: 1,
      episodeNumber: 2,
    });
    expect(renumbered).not.toBe(second?.media_id);
  });

  it('keeps one media row per episode when an import and a library sync resolve it at the same time, every time', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    for (let round = 0; round < 12; round++) {
      const showId = await libraryShow(server.id, `rk-race-${round}`, `Race Harbor ${round}`, 2020);
      const ratingKey = `rk-race-${round}-s1e1`;
      const sync = async () => {
        const resolved = await resolveMediaBatch([
          {
            mediaType: 'episode',
            tvdbId: 72_100 + round,
            title: 'Pilot',
            serverId: server.id,
            ratingKey,
            showMediaId: showId,
            seasonNumber: 1,
            episodeNumber: 1,
          },
        ]);
        await createTestLibraryItem({
          serverId: server.id,
          ratingKey,
          title: 'Pilot',
          mediaType: 'episode',
          grandparentRatingKey: `rk-race-${round}`,
          parentIndex: 1,
          itemIndex: 1,
          mediaId: resolved.get(ratingKey) ?? null,
        });
      };
      await Promise.all([
        flushInsertBatch([
          importedRow(server.id, user, {
            mediaType: 'episode',
            mediaTitle: 'Pilot',
            grandparentTitle: `Race Harbor ${round}`,
            seasonNumber: 1,
            episodeNumber: 1,
          }),
        ]),
        sync(),
      ]);
      await reconcileMediaDuplicates();

      const rows = (
        await db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM media m WHERE m.media_type = 'episode' AND m.show_media_id = ${showId}::uuid AND m.merged_into_id IS NULL) AS episode_rows,
            (SELECT COALESCE(pm.merged_into_id, p.media_id)::text FROM sessions p LEFT JOIN media pm ON pm.id = p.media_id
              WHERE p.server_id = ${server.id}::uuid AND p.grandparent_title = ${`Race Harbor ${round}`}) AS play_row,
            (SELECT COALESCE(im.merged_into_id, li.media_id)::text FROM library_items li LEFT JOIN media im ON im.id = li.media_id
              WHERE li.server_id = ${server.id}::uuid AND li.rating_key = ${ratingKey}) AS item_row
        `)
      ).rows[0] as { episode_rows: number; play_row: string | null; item_row: string | null };
      expect(rows.episode_rows, `round ${round}`).toBe(1);
      expect(rows.play_row, `round ${round}`).not.toBeNull();
      expect(rows.play_row, `round ${round}`).toBe(rows.item_row);
    }
  });

  it("heals only an item-less number-keyed row into the one library row, never two servers' own rows", async () => {
    const serverA = await createTestServer({ type: 'jellyfin' });
    const serverB = await createTestServer({ type: 'plex' });
    const showId = await libraryShow(serverA.id, 'rk-two-a', 'Two Servers', 2020);
    await createTestLibraryItem({
      serverId: serverB.id,
      ratingKey: 'rk-two-b',
      title: 'Two Servers',
      mediaType: 'show',
      mediaId: showId,
      withoutVersion: true,
    });
    const numberKeyed = await resolveMediaForItem({
      mediaType: 'episode',
      title: 'First Ordering',
      serverId: serverA.id,
      ratingKey: 'rk-two-a-s1e1',
      showMediaId: showId,
      seasonNumber: 1,
      episodeNumber: 1,
    });
    await createTestLibraryItem({
      serverId: serverA.id,
      ratingKey: 'rk-two-a-s1e1',
      title: 'First Ordering',
      mediaType: 'episode',
      grandparentRatingKey: 'rk-two-a',
      parentIndex: 1,
      itemIndex: 1,
      mediaId: numberKeyed,
    });
    const idKeyed = await resolveMediaForItem({
      mediaType: 'episode',
      tvdbId: 73_001,
      title: 'Second Ordering',
      serverId: serverB.id,
      ratingKey: 'rk-two-b-s1e1',
      showMediaId: showId,
      seasonNumber: 1,
      episodeNumber: 1,
    });
    await createTestLibraryItem({
      serverId: serverB.id,
      ratingKey: 'rk-two-b-s1e1',
      title: 'Second Ordering',
      mediaType: 'episode',
      grandparentRatingKey: 'rk-two-b',
      parentIndex: 1,
      itemIndex: 1,
      mediaId: idKeyed,
    });
    expect(idKeyed).not.toBe(numberKeyed);

    await reconcileMediaDuplicates();

    const unmerged = (
      await db.execute(
        sql`SELECT id FROM media WHERE media_type = 'episode' AND show_media_id = ${showId}::uuid AND merged_into_id IS NULL`
      )
    ).rows.map((row) => String((row as { id: string }).id));
    expect(unmerged.sort()).toEqual([idKeyed, numberKeyed].sort());

    const orphan = await resolveMediaForItem({
      mediaType: 'episode',
      title: 'Second',
      serverId: 'import',
      ratingKey: 'import:episode:two-s1e2',
      showMediaId: showId,
      seasonNumber: 1,
      episodeNumber: 2,
    });
    const owned = await libraryEpisode(serverB.id, { id: showId, ratingKey: 'rk-two-b' }, 1, 2);
    await reconcileMediaDuplicates();
    const [row] = (
      await db.execute(sql`SELECT merged_into_id FROM media WHERE id = ${orphan}::uuid`)
    ).rows as Array<{ merged_into_id: string | null }>;
    expect(row?.merged_into_id).toBe(owned);
  });

  it('folds a stylized history title onto the surviving show after the folded show is merged away', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const first = await libraryShow(server.id, 'rk-fold-a', 'Fold Harbor', 2021);
    const episodeId = await libraryEpisode(server.id, { id: first, ratingKey: 'rk-fold-a' }, 1, 1);
    await createTestSession({
      serverId: server.id,
      serverUserId: user,
      externalSessionId: null,
      mediaId: episodeId,
      showMediaId: first,
      mediaType: 'episode',
      mediaTitle: 'Pilot',
      grandparentTitle: 'F0LD HARB0R',
      ratingKey: 'rk-fold-a-s1e1',
      startedAt: daysAgo(5),
    });
    const [primed] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Second',
        grandparentTitle: 'F0LD HARB0R',
        seasonNumber: 1,
        episodeNumber: 2,
        year: 2022,
      }),
    ]);
    expect(primed?.show_media_id).toBe(first);

    const survivor = await libraryShow(server.id, 'rk-fold-b', 'Fold Harbor Again', 2021);
    await mergeMediaRows(survivor, first);
    const [later] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Third',
        grandparentTitle: 'F0LD HARB0R',
        seasonNumber: 1,
        episodeNumber: 3,
        year: 2022,
      }),
    ]);

    expect(later?.show_media_id).toBe(survivor);
  });

  it('lets an id-less library show land on the year-less show row an earlier import created', async () => {
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    const [row] = await importPlays([
      importedRow(server.id, user, {
        mediaType: 'episode',
        mediaTitle: 'Pilot',
        grandparentTitle: 'Pre Sync Harbor',
        seasonNumber: 1,
        episodeNumber: 1,
      }),
    ]);
    expect(row?.show_media_id).not.toBeNull();

    const synced = await resolveMediaForItem({
      mediaType: 'show',
      title: 'Pre Sync Harbor',
      year: 2020,
      serverId: server.id,
      ratingKey: 'rk-presync',
    });

    expect(synced).toBe(row?.show_media_id);
    expect(await mediaRows('show', 'Pre Sync Harbor')).toHaveLength(1);
  });

  it('resolves a dated id-less input to the dated library row ahead of a year-less import row for the title', async () => {
    const server = await createTestServer({ type: 'plex' });
    const libraryId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 74_001,
      title: 'Twin Harbor Film',
      year: 2001,
      serverId: server.id,
      ratingKey: 'rk-dated',
    });
    const yearless = await resolveMediaForItem({
      mediaType: 'movie',
      title: 'Twin Harbor Film',
      year: null,
      serverId: 'import',
      ratingKey: 'import:movie:twin',
    });
    expect(yearless).not.toBe(libraryId);

    const batch = await resolveMediaBatch([
      {
        mediaType: 'movie',
        title: 'Twin Harbor Film',
        year: 2002,
        serverId: server.id,
        ratingKey: 'rk-batch',
      },
    ]);
    const single = await resolveMediaForItem({
      mediaType: 'movie',
      title: 'Twin Harbor Film',
      year: 2002,
      serverId: server.id,
      ratingKey: 'rk-single',
    });

    expect(batch.get('rk-batch')).toBe(libraryId);
    expect(single).toBe(libraryId);
    expect(await mediaRows('movie', 'Twin Harbor Film')).toHaveLength(2);
  });

  it('dispatches no automation event and announces nothing while resolving imports at insert and in the walk', async () => {
    const dispatchers = producers as unknown as Record<string, (...args: unknown[]) => unknown>;
    const spies = Object.keys(dispatchers)
      .filter((name) => name.startsWith('dispatch') && typeof dispatchers[name] === 'function')
      .map((name) => vi.spyOn(dispatchers, name));
    expect(spies.length).toBeGreaterThan(5);
    const server = await createTestServer({ type: 'plex' });
    const user = await account(server.id);
    await libraryMovie(server.id, 'rk-quiet-film', 'Quiet Film', 2020);
    const itemsBefore = (await db.execute(sql`SELECT count(*)::int AS n FROM library_items`))
      .rows[0] as { n: number };

    await importPlays([
      importedRow(server.id, user, { mediaTitle: 'Quiet Film', year: 2020 }),
      importedRow(server.id, user, { mediaTitle: 'Unknown Film', year: 1999 }),
    ]);
    await createTestSession({
      serverId: server.id,
      serverUserId: user,
      mediaId: null,
      mediaType: 'movie',
      mediaTitle: 'Unknown Film',
      year: 1999,
      ratingKey: 'rk-old-film',
      externalSessionId: 'walk-1',
      startedAt: daysAgo(3),
    });
    await stampPendingSessionIdentity(false);
    await runSessionIdentityBackfillWalk({
      batchSize: 100,
      getCompressedRanges: getCompressedSessionChunkRanges,
      getChunkRanges: getSessionChunkRanges,
    });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const itemsAfter = (await db.execute(sql`SELECT count(*)::int AS n FROM library_items`))
      .rows[0] as { n: number };
    expect(itemsAfter.n).toBe(itemsBefore.n);
    const [walked] = (
      await db.execute(sql`SELECT media_id FROM sessions WHERE external_session_id = 'walk-1'`)
    ).rows as Array<{ media_id: string | null }>;
    expect(walked?.media_id).not.toBeNull();
    for (const spy of spies) spy.mockRestore();
  });
});
