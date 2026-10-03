import { asc, desc, sql, type SQL } from 'drizzle-orm';
import { servers } from '../db/schema.js';
import { compareNames } from './collation.js';

/**
 * Live servers first. Every server insert leaves display_order at 0 (migration
 * 0040 numbered only the servers that existed then), so the order needs the
 * name as a tiebreak.
 */
export function serverOrderBy(): SQL[] {
  return [
    desc(sql`${servers.historicalAt} IS NULL`),
    asc(servers.displayOrder),
    asc(sql`lower(${servers.name})`),
    asc(servers.id),
  ];
}

export function compareServers(
  a: { historicalAt: Date | string | null; displayOrder: number; name: string; id: string },
  b: { historicalAt: Date | string | null; displayOrder: number; name: string; id: string }
): number {
  return (
    Number(a.historicalAt !== null) - Number(b.historicalAt !== null) ||
    a.displayOrder - b.displayOrder ||
    compareNames(a.name, b.name) ||
    a.id.localeCompare(b.id)
  );
}
