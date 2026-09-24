import { asc, sql, type SQL } from 'drizzle-orm';
import { servers } from '../db/schema.js';
import { compareNames } from './collation.js';

/**
 * Every server insert leaves display_order at 0 (migration 0040 numbered only
 * the servers that existed then), so the order needs the name as a tiebreak.
 */
export function serverOrderBy(): SQL[] {
  return [asc(servers.displayOrder), asc(sql`lower(${servers.name})`), asc(servers.id)];
}

export function compareServers(
  a: { displayOrder: number; name: string; id: string },
  b: { displayOrder: number; name: string; id: string }
): number {
  return (
    a.displayOrder - b.displayOrder || compareNames(a.name, b.name) || a.id.localeCompare(b.id)
  );
}
