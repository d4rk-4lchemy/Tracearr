import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { uncapDecompressionForTx, type ChunkTimeRange } from '../db/timescale.js';
import { CONTAINER_MEDIA_TYPES_SQL } from './poller/database.js';
import {
  byInstant,
  drainWindowsWithBisection,
  type BackfillWalkResult,
  type BackfillWindow,
} from './sessionWalk.js';

/**
 * Where each pass (fresh, repair, unlink) continues in the next batch of the
 * same window: an inclusive started_at upper bound, or null once the pass has
 * nothing left to find.
 */
export type IdentityPassBounds = [string | null, string | null, string | null];

type StampedRows = Array<{ started_at: string }>;

function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return byInstant(a, b) >= 0 ? a : b;
}

function oldestOf(rows: StampedRows): string | null {
  return rows.reduce<string | null>(
    (min, r) => (min === null || byInstant(r.started_at, min) < 0 ? r.started_at : min),
    null
  );
}

/**
 * Stamp canonical media identity onto historical sessions in one bounded batch.
 *
 * Three passes, each windowed the same way (ORDER BY started_at DESC LIMIT):
 * - Fresh stamp: joins sessions to library_items on (server_id, rating_key) and
 *   copies the resolved media id, show id, and provider ids. Sessions whose rating
 *   key has no non-container library item pointing at a non-container media row
 *   are excluded so they never re-select.
 * - Show-link repair: sessions that already have media_id but were stamped before
 *   their media row's show_media_id existed (e.g. the show synced later). Re-running
 *   this is safe - a repaired session no longer matches either pass's WHERE clause.
 * - Container unlink: sessions linked to a show, season, artist or album media row
 *   lose their media and provider ids. The fresh stamp refuses container items, so
 *   an unlinked session is never stamped back onto one.
 *
 * The optional started_at window is what keeps this survivable on a compressed
 * hypertable: one transaction per chunk bounds tuple decompression to a single
 * chunk's segments. The per-transaction cap is lifted inside that bound - a
 * busy month-chunk decompresses more tuples than the 100k default even for a
 * 10k-row batch, and tripping the cap turns the walk into a fail-retry loop.
 * The window is the memory guard, not the cap; an unwindowed batch with the
 * cap disabled globally is what once ballooned until the OOM killer took
 * postgres down.
 *
 * `bounds` is the cursor the previous batch of the same window returned. Each
 * pass picks its newest rows first, so a pass that filled its limit has
 * written every match newer than its oldest row, and one that came back short
 * has written every match below its bound. A written row stops matching its
 * own pass, which is why the bound can be inclusive without an id tiebreak:
 * only unwritten ties come back. The passes feed each other, though. A fresh
 * stamp can create repair work in the same batch, and an unlink can create
 * fresh work for the next one, so a pass's next bound also covers the rows the
 * pass feeding it wrote or will write.
 */
export async function backfillSessionIdentityBatch(
  limit: number,
  window?: BackfillWindow,
  bounds?: IdentityPassBounds
): Promise<{ updated: number; oldest: Date | null; cursor: IdentityPassBounds }> {
  if (bounds?.every((bound) => bound === null)) {
    return { updated: 0, oldest: null, cursor: bounds };
  }
  const startFilter = window?.start
    ? sql`AND s.started_at >= ${window.start.toISOString()}::timestamptz`
    : sql``;
  const endFilter = window?.end
    ? sql`AND s.started_at < ${window.end.toISOString()}::timestamptz`
    : sql``;
  const range = (pass: 0 | 1 | 2): SQL => {
    const bound = bounds?.[pass];
    return bound
      ? sql`${startFilter} ${endFilter} AND s.started_at <= ${bound}::timestamptz`
      : sql`${startFilter} ${endFilter}`;
  };
  const skip = (pass: 0 | 1 | 2) => bounds?.[pass] === null;

  const [freshRows, repairRows, unlinkRows] = await db.transaction(async (tx) => {
    await uncapDecompressionForTx(tx);
    // Raw db.execute results carry timestamptz columns as Postgres text, not Date.
    const stamp = async (pass: 0 | 1 | 2, query: SQL): Promise<StampedRows> =>
      skip(pass) ? [] : ((await tx.execute(query)).rows as unknown as StampedRows);

    const fresh = await stamp(
      0,
      sql`
      WITH batch AS (
        SELECT s.id, s.started_at, s.server_id, s.rating_key
        FROM sessions s
        WHERE s.media_id IS NULL AND s.rating_key IS NOT NULL
          ${range(0)}
          AND EXISTS (
            SELECT 1 FROM library_items li2
            JOIN media m2 ON m2.id = li2.media_id
            WHERE li2.server_id = s.server_id AND li2.rating_key = s.rating_key
              AND li2.media_id IS NOT NULL
              AND li2.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
              AND m2.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
          )
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      )
      UPDATE sessions s
      SET media_id = li.media_id,
          show_media_id = CASE WHEN li.media_type = 'episode' THEN m.show_media_id END,
          imdb_id = li.imdb_id,
          tmdb_id = li.tmdb_id,
          tvdb_id = li.tvdb_id,
          parent_rating_key = li.parent_rating_key,
          grandparent_rating_key = li.grandparent_rating_key
      FROM batch b
      JOIN library_items li ON li.server_id = b.server_id AND li.rating_key = b.rating_key
      JOIN media m ON m.id = li.media_id
      WHERE s.id = b.id AND s.started_at = b.started_at AND li.media_id IS NOT NULL
        AND li.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
        AND m.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
        ${range(0)}
      RETURNING s.started_at
    `
    );

    const repair = await stamp(
      1,
      sql`
      WITH batch AS (
        SELECT s.id, s.started_at, m.show_media_id AS new_show_media_id
        FROM sessions s
        JOIN media m ON m.id = s.media_id
        WHERE s.media_id IS NOT NULL AND s.show_media_id IS NULL AND m.show_media_id IS NOT NULL
          ${range(1)}
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      )
      UPDATE sessions s
      SET show_media_id = b.new_show_media_id
      FROM batch b
      WHERE s.id = b.id AND s.started_at = b.started_at
        ${range(1)}
      RETURNING s.started_at
    `
    );

    const unlink = await stamp(
      2,
      sql`
      WITH batch AS (
        SELECT s.id, s.started_at
        FROM sessions s
        JOIN media m ON m.id = s.media_id
        WHERE m.media_type IN (${CONTAINER_MEDIA_TYPES_SQL})
          ${range(2)}
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      )
      UPDATE sessions s
      SET media_id = NULL, show_media_id = NULL, imdb_id = NULL, tmdb_id = NULL, tvdb_id = NULL
      FROM batch b
      WHERE s.id = b.id AND s.started_at = b.started_at
        ${range(2)}
      RETURNING s.started_at
    `
    );

    return [fresh, repair, unlink] as const;
  });

  const own = (rows: StampedRows) => (rows.length >= limit ? oldestOf(rows) : null);
  const newestUnlinked = unlinkRows.reduce<string | null>(
    (max, r) => laterOf(max, r.started_at),
    null
  );
  const nextFresh = laterOf(own(freshRows), newestUnlinked);
  const oldest = oldestOf([...freshRows, ...repairRows, ...unlinkRows]);
  return {
    updated: freshRows.length + repairRows.length + unlinkRows.length,
    oldest: oldest ? new Date(oldest) : null,
    cursor: [nextFresh, laterOf(own(repairRows), nextFresh), own(unlinkRows)],
  };
}

/**
 * Existence probe for identity work remaining below a cutoff on one server's
 * rating keys - the sync tail asks it about the keys it upserted to decide
 * whether compressed history still needs the maintenance walk. Mirrors the
 * three passes of backfillSessionIdentityBatch in one statement. The key
 * filter is what keeps it cheap: compressed segments are skipped on the
 * rating_key bloom filter, and uncompressed chunks use sessions_server_rating_idx.
 */
export async function hasStampableSessionsBefore(
  cutoff: Date,
  serverId: string,
  ratingKeys: string[]
): Promise<boolean> {
  const before = cutoff.toISOString();
  const scope = sql`s.server_id = ${serverId}::uuid
        AND s.rating_key = ANY(${sql.param(ratingKeys)}::text[])
        AND s.started_at < ${before}::timestamptz`;
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.media_id IS NULL AND s.rating_key IS NOT NULL
        AND ${scope}
        AND EXISTS (
          SELECT 1 FROM library_items li
          JOIN media m ON m.id = li.media_id
          WHERE li.server_id = s.server_id AND li.rating_key = s.rating_key
            AND li.media_id IS NOT NULL
            AND li.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
            AND m.media_type NOT IN (${CONTAINER_MEDIA_TYPES_SQL})
        )
    ) OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN media m ON m.id = s.media_id
      WHERE s.show_media_id IS NULL AND m.show_media_id IS NOT NULL
        AND ${scope}
    ) OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN media m ON m.id = s.media_id
      WHERE m.media_type IN (${CONTAINER_MEDIA_TYPES_SQL})
        AND ${scope}
    ) AS stampable
  `);
  return (result.rows[0] as { stampable?: boolean } | undefined)?.stampable === true;
}

/**
 * Drain the whole backlog: the uncompressed region first (everything newer
 * than the newest compressed chunk), then each compressed chunk as its own
 * bounded window, newest first, then each chunk that sits below the horizon
 * without being compressed (e.g. a manually decompressed one).
 *
 * Every chunk window goes through drainWindowsWithBisection, so a failing
 * chunk is bisected and recorded rather than blocking the rest of history. The
 * uncompressed chunks below the horizon are skipped after any compressed-chunk
 * failure, so a failed walk stops where it failed.
 */
export async function runSessionIdentityBackfillWalk(deps: {
  batchSize: number;
  getCompressedRanges: () => Promise<ChunkTimeRange[]>;
  getChunkRanges: () => Promise<ChunkTimeRange[]>;
  runBatch?: (
    limit: number,
    window?: BackfillWindow,
    bounds?: IdentityPassBounds
  ) => Promise<{ updated: number; oldest: Date | null; cursor?: IdentityPassBounds }>;
  /** Called after every batch with the running total (progress + lock extension) */
  onBatch?: (total: number) => Promise<void>;
  /** Called as soon as a batch commits, with its oldest touched started_at */
  onCommit?: (oldest: Date | null) => void;
}): Promise<BackfillWalkResult> {
  const {
    batchSize,
    getCompressedRanges,
    getChunkRanges,
    runBatch = backfillSessionIdentityBatch,
    onBatch,
    onCommit,
  } = deps;
  let total = 0;
  let earliest: Date | null = null;

  // Totals accumulate here rather than from each drain's result: a drain that
  // rejects still committed the batches before the failure, and they must count.
  const stamp = async (window: BackfillWindow | undefined, bounds?: IdentityPassBounds) => {
    const batch = await runBatch(batchSize, window, bounds);
    total += batch.updated;
    if (batch.oldest && (!earliest || batch.oldest < earliest)) earliest = batch.oldest;
    onCommit?.(batch.oldest);
    return { count: batch.updated, oldest: batch.oldest, cursor: batch.cursor };
  };
  const opts = {
    batchSize,
    label: 'SessionIdentityBackfill',
    onBatch: async () => {
      await onBatch?.(total);
    },
  };

  const compressed = await getCompressedRanges();
  const horizon = compressed[0]?.end;
  // Uncaught on purpose: this region is uncompressed, so a failure here is a
  // plain SQL or connectivity fault rather than a decompression-cap trip.
  await drainWindowsWithBisection<IdentityPassBounds>(
    null,
    (_window, bounds) => stamp(horizon ? { start: horizon } : undefined, bounds),
    opts
  );

  const { failedRanges } = await drainWindowsWithBisection<IdentityPassBounds>(
    compressed,
    (window, bounds) => stamp(window ?? undefined, bounds),
    opts
  );

  if (horizon && failedRanges.length === 0) {
    const compressedStarts = new Set(compressed.map((range) => range.start.getTime()));
    const uncompressedBelow = (await getChunkRanges()).filter(
      (range) => range.start < horizon && !compressedStarts.has(range.start.getTime())
    );
    // A chunk compressed after the list was read trips the cap like any
    // compressed chunk would, and is bisected and recorded the same way.
    const sweep = await drainWindowsWithBisection<IdentityPassBounds>(
      uncompressedBelow,
      (window, bounds) => stamp(window ?? undefined, bounds),
      opts
    );
    failedRanges.push(...sweep.failedRanges);
  }

  return { total, earliest, failedRanges };
}
