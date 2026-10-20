/**
 * Session Query Constants
 */

import { sql, type SQL } from 'drizzle-orm';

// Count unique plays — COALESCE(reference_id, id) collapses pause/resume chains into one play
export const PLAY_COUNT = sql<number>`count(distinct coalesce(reference_id, id))::int`;

// A session counts toward plays and watch time once it runs 2 minutes or passes the
// watched threshold for its media type, so a track or short film played to the end counts.
// Gates on duration, not short_session: the flag is unset on some imported history
export function countedSession(alias = ''): string {
  const col = alias ? `${alias}.` : '';
  return `(COALESCE(${col}duration_ms, 0) >= 120000 OR ${col}watched)`;
}

export const countedSessionSql = (alias?: string): SQL => sql.raw(countedSession(alias));
