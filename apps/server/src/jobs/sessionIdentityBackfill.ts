import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

/**
 * Stamp canonical media identity onto historical sessions in one bounded batch.
 *
 * Two passes, each windowed the same way (ORDER BY started_at DESC LIMIT):
 * - Fresh stamp: joins sessions to library_items on (server_id, rating_key) and
 *   copies the resolved media id, show id, and provider ids. Sessions whose rating
 *   key has no library item with a resolvable media id are excluded so they never
 *   re-select.
 * - Show-link repair: sessions that already have media_id but were stamped before
 *   their media row's show_media_id existed (e.g. the show synced later). Re-running
 *   this is safe - a repaired session no longer matches either pass's WHERE clause.
 */
export async function backfillSessionIdentityBatch(
  limit: number
): Promise<{ updated: number; oldest: Date | null }> {
  const { freshRows, repairRows } = await db.transaction(async (tx) => {
    // sessions is a compressed hypertable; without this, the default
    // timescaledb.max_tuples_decompressed_per_dml_transaction=100000 aborts the
    // UPDATE on any compressed chunk with more matching rows than the limit.
    // Pre-2.11 TimescaleDB has no such GUC, so check pg_settings before setting it.
    const guc = await tx.execute(
      sql`SELECT 1 FROM pg_settings WHERE name = 'timescaledb.max_tuples_decompressed_per_dml_transaction'`
    );
    if (guc.rows.length > 0) {
      await tx.execute(sql`SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`);
    }
    const fresh = await tx.execute(sql`
      WITH batch AS (
        SELECT s.id, s.started_at, s.server_id, s.rating_key
        FROM sessions s
        WHERE s.media_id IS NULL AND s.rating_key IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM library_items li2
            WHERE li2.server_id = s.server_id AND li2.rating_key = s.rating_key
              AND li2.media_id IS NOT NULL
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
      LEFT JOIN media m ON m.id = li.media_id
      WHERE s.id = b.id AND s.started_at = b.started_at AND li.media_id IS NOT NULL
      RETURNING s.started_at
    `);

    const repair = await tx.execute(sql`
      WITH batch AS (
        SELECT s.id, s.started_at, m.show_media_id AS new_show_media_id
        FROM sessions s
        JOIN media m ON m.id = s.media_id
        WHERE s.media_id IS NOT NULL AND s.show_media_id IS NULL AND m.show_media_id IS NOT NULL
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      )
      UPDATE sessions s
      SET show_media_id = b.new_show_media_id
      FROM batch b
      WHERE s.id = b.id AND s.started_at = b.started_at
      RETURNING s.started_at
    `);

    return { freshRows: fresh.rows, repairRows: repair.rows };
  });
  // Raw db.execute results carry timestamptz columns as Postgres text, not Date.
  const combined = [
    ...(freshRows as unknown as Array<{ started_at: string }>),
    ...(repairRows as unknown as Array<{ started_at: string }>),
  ];
  const oldestStr = combined.length
    ? combined.reduce(
        (min, r) => (r.started_at < min ? r.started_at : min),
        combined[0]!.started_at
      )
    : null;
  return { updated: combined.length, oldest: oldestStr ? new Date(oldestStr) : null };
}
