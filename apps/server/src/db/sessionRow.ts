import { type SQL, between, eq, gte, sql } from 'drizzle-orm';
import { sessions } from './schema.js';

type SessionRowRef = { id: string; startedAt: Date | number | string };

/**
 * Match one session by id plus a floor on its started_at. started_at is the compression
 * orderby, so without the floor an id-only read or write scans every compressed batch. The
 * minute of slack covers the microseconds a JS Date drops from the stored timestamptz.
 * Floor only: on live paths the stored started_at can be later than the caller's value.
 */
export function sessionRowById(row: SessionRowRef): SQL {
  const at = new Date(row.startedAt).getTime();
  return sql`(${eq(sessions.id, row.id)} and ${gte(sessions.startedAt, new Date(at - 60_000))})`;
}

/**
 * sessionRowById for a startedAt read from the row itself, so a minute either side pins the
 * write to the one or two chunks around it.
 */
export function storedSessionRowById(row: SessionRowRef): SQL {
  const at = new Date(row.startedAt).getTime();
  const window = between(sessions.startedAt, new Date(at - 60_000), new Date(at + 60_000));
  return sql`(${eq(sessions.id, row.id)} and ${window})`;
}
