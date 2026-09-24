/**
 * An *arr upgrade deletes the old file and imports the new one, so the server
 * drops the item and creates another. The row that arrives carries a fresh
 * first_seen_at and a reset added date, and surfaces that promise novelty
 * announce a title the library already had. An in-place swap needs none of
 * this: neither timestamp moves, so those rows never re-enter a window.
 */

import { sql, type SQL } from 'drizzle-orm';

/** Every observed pair closes within the hour; a week leaves a title reacquired months later counting as news. */
export const RE_ADD_WINDOW_DAYS = 7;

/** Scoped per server: the same title arriving on a second server is a genuine addition there. */
export function reAddedPredicate(alias = 'li'): SQL {
  const row = sql.raw(alias);
  const seen = sql.raw(`COALESCE(${alias}.first_seen_at, ${alias}.created_at)`);
  return sql`EXISTS (
    SELECT 1 FROM library_items prior
    WHERE prior.media_id = ${row}.media_id
      AND prior.id <> ${row}.id
      AND prior.server_id = ${row}.server_id
      AND prior.removed_at IS NOT NULL
      AND COALESCE(prior.first_seen_at, prior.created_at) < ${seen}
      AND prior.removed_at >= ${seen} - ${RE_ADD_WINDOW_DAYS} * interval '1 day'
  )`;
}
