import { sql, type SQL } from 'drizzle-orm';
import { LOCAL_NETWORK_COUNTRY } from '@tracearr/shared';

export interface LocalSessionFields {
  isLocal?: boolean | null;
  geoCountry: string | null;
  geoCity: string | null;
  geoLat: number | null;
}

/**
 * The flag decides once set. Before the location sync has classified a row its label does:
 * the Local Network sentinel, or the pre-2025-12-22 'Local' city, which never had coordinates.
 */
export function isLocalSession(row: LocalSessionFields): boolean {
  if (row.isLocal != null) return row.isLocal;
  return (
    row.geoCountry === LOCAL_NETWORK_COUNTRY ||
    (row.geoCity?.toLowerCase() === 'local' && row.geoLat === null)
  );
}

// Inlined, not bound: GROUP BY only matches a SELECT expression whose text is identical.
const LOCAL_LABEL = sql.raw(`'${LOCAL_NETWORK_COUNTRY}'`);

/** isLocalSession in SQL. Never NULL, so NOT (...) selects every remote row. */
export function localSessionSql(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.is_local IS TRUE OR (${a}.is_local IS NULL AND (${a}.geo_country IS NOT DISTINCT FROM ${LOCAL_LABEL} OR (lower(${a}.geo_city) IS NOT DISTINCT FROM 'local' AND ${a}.geo_lat IS NULL))))`;
}
