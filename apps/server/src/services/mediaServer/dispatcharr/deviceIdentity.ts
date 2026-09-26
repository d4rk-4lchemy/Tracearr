import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

const LEGACY_PLAYER_NAMES = [
  'Dispatcharr Client',
  'Dispatcharr VOD Client',
  'Dispatcharr Catch-up Client',
];

// ECMAScript String.trim whitespace, also used by PostgreSQL btrim below.
const TRIM_CHARACTERS =
  ' \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

export interface DispatcharrDeviceSource {
  serverId: string;
  serverUserId: string;
  dispatcharrUserAgent?: string | null;
  product?: string | null;
  playerName?: string | null;
}

/** NULL means legacy data; an empty raw agent means a known missing agent. */
export function dispatcharrUserAgent(
  source: Pick<DispatcharrDeviceSource, 'dispatcharrUserAgent' | 'product' | 'playerName'>
): string {
  if (source.dispatcharrUserAgent != null) return source.dispatcharrUserAgent.trim();
  const legacy = source.product?.trim() || source.playerName?.trim() || '';
  return LEGACY_PLAYER_NAMES.includes(legacy) ? '' : legacy;
}

/** Device identity only. Never use this for connection tracking or termination. */
export function dispatcharrDeviceId(source: DispatcharrDeviceSource): string {
  return (
    'dispatcharr:v1:' +
    createHash('sha256')
      .update(JSON.stringify([source.serverId, source.serverUserId, dispatcharrUserAgent(source)]))
      .digest('hex')
  );
}

/** Alias is a code-owned SQL identifier, never request input. */
export function dispatcharrUserAgentSql(alias = 'sessions'): SQL<string> {
  const column = (name: string) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
  const trim = (value: SQL) => sql`btrim(${value}, ${TRIM_CHARACTERS})`;
  const legacy = sql`COALESCE(NULLIF(${trim(column('product'))}, ''), ${trim(column('player_name'))}, '')`;
  return sql<string>`CASE WHEN ${column('dispatcharr_user_agent')} IS NOT NULL
    THEN ${trim(column('dispatcharr_user_agent'))}
    WHEN ${legacy} IN (${sql.join(
      LEGACY_PLAYER_NAMES.map((name) => sql`${name}`),
      sql`, `
    )}) THEN ''
    ELSE ${legacy} END`;
}

/** Matches JSON.stringify([serverId, serverUserId, agent]) without JSON's SQL spacing. */
export function dispatcharrDeviceIdSql(alias = 'sessions'): SQL<string | null> {
  const column = (name: string) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
  const payload = sql`'[' || to_json(${column('server_id')}::text)::text || ',' ||
    to_json(${column('server_user_id')}::text)::text || ',' ||
    to_json(${dispatcharrUserAgentSql(alias)})::text || ']'`;
  return sql<string | null>`CASE WHEN EXISTS (
    SELECT 1 FROM servers AS device_server
    WHERE device_server.id = ${column('server_id')} AND device_server.type = 'dispatcharr'
  ) THEN 'dispatcharr:v1:' || encode(sha256(convert_to(${payload}, 'UTF8')), 'hex') END`;
}

/** Preserve provider device semantics for every non-Dispatcharr session. */
export function deviceIdentity(session: {
  dispatcharrDeviceId?: string | null;
  deviceId?: string | null;
}): string | null {
  return session.dispatcharrDeviceId ?? session.deviceId ?? null;
}
