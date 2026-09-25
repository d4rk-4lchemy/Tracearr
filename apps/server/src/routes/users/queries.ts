/** Shared User Query Functions **/

import { dispatcharrDeviceIdSql } from '../../services/mediaServer/dispatcharr/deviceIdentity.js';
import type { UserDevice, AuthUser, UserLocation } from '@tracearr/shared';
import { sql, eq, and, inArray } from 'drizzle-orm';
import type { db as defaultDb } from '../../db/client.js';
import { serverUsers } from '../../db/schema.js';
import { buildServerAccessCondition, hasServerAccess } from '../../utils/serverFiltering.js';
import { uuidArraySql } from '../../utils/sqlArrays.js';
import { localSessionSql } from '../../utils/localSession.js';

// Accept either the default db or a transaction context
type DbOrTx = typeof defaultDb;

/**
 * All server_user ids belonging to a person's identity that the caller can
 * access. Always scoped by the caller's accessible servers (owners see every
 * sibling account, everyone else only their own accessible servers) so an
 * identity-wide query can never surface accounts on servers the caller
 * doesn't have access to.
 */
export async function resolveAccessibleServerUserIdsForIdentity(
  dbOrTx: DbOrTx,
  authUser: AuthUser,
  identityUserId: string
): Promise<string[]> {
  return resolveAccessibleServerUserIdsForIdentities(dbOrTx, authUser, [identityUserId]);
}

/**
 * Batched version of resolveAccessibleServerUserIdsForIdentity - the union of
 * every accessible server_user id across all given identities in a single
 * query. An identity with no accessible account under the caller's server
 * access contributes nothing to the union (fail-closed), same as the
 * singular resolver.
 */
export async function resolveAccessibleServerUserIdsForIdentities(
  dbOrTx: DbOrTx,
  authUser: AuthUser,
  identityUserIds: string[]
): Promise<string[]> {
  if (identityUserIds.length === 0) return [];

  const accessCondition = buildServerAccessCondition(authUser, serverUsers.serverId);
  const where = accessCondition
    ? and(inArray(serverUsers.userId, identityUserIds), accessCondition)
    : inArray(serverUsers.userId, identityUserIds);

  const rows = await dbOrTx.select({ id: serverUsers.id }).from(serverUsers).where(where);
  return rows.map((row) => row.id);
}

/**
 * Resolve the set of server_user ids a per-account endpoint (anchored on
 * `:id`) should query against: just `[id]` by default, or every accessible
 * sibling account under the same identity when `scope=identity` is set.
 */
export async function resolveIdentityScopedServerUserIds(
  dbOrTx: DbOrTx,
  authUser: AuthUser,
  id: string,
  scope: 'identity' | undefined
): Promise<
  | { error: 'notFound' }
  | { error: 'forbidden' }
  | { serverUser: { id: string; serverId: string; userId: string }; ids: string[] }
> {
  const rows = await dbOrTx
    .select({ id: serverUsers.id, serverId: serverUsers.serverId, userId: serverUsers.userId })
    .from(serverUsers)
    .where(eq(serverUsers.id, id))
    .limit(1);

  const serverUser = rows[0];
  if (!serverUser) {
    return { error: 'notFound' };
  }
  if (!hasServerAccess(authUser, serverUser.serverId)) {
    return { error: 'forbidden' };
  }
  if (scope !== 'identity') {
    return { serverUser, ids: [id] };
  }

  const ids = await resolveAccessibleServerUserIdsForIdentity(dbOrTx, authUser, serverUser.userId);
  // The anchor account is always part of its own identity and already passed
  // the access check above, so this can't come back empty in practice.
  return { serverUser, ids: ids.length > 0 ? ids : [id] };
}

/**
 * Build a `<columnRef> = ANY(...)` SQL fragment for a raw query.
 */
export function serverUserIdAnyFragment(ids: string[], columnRef = 'server_user_id') {
  return sql`${sql.raw(columnRef)} = ANY(${uuidArraySql(ids)})`;
}

/**
 * Deduplicate to one row per play, then aggregate by location.
 * Each play is assigned to its most recent segment's location.
 */
export async function queryUserLocations(
  dbOrTx: DbOrTx,
  serverUserIds: string[],
  window?: { start: Date; end: Date }
): Promise<UserLocation[]> {
  const bounds = window
    ? sql`AND started_at >= ${window.start} AND started_at <= ${window.end}`
    : sql``;
  const result = await dbOrTx.execute(sql`
    WITH plays AS (
      SELECT DISTINCT ON (COALESCE(reference_id, id))
        geo_city, geo_region, geo_country, geo_lat, geo_lon,
        ${localSessionSql('sessions')} AS local_flag,
        ip_address, started_at
      FROM sessions
      WHERE ${serverUserIdAnyFragment(serverUserIds)}
        ${bounds}
      ORDER BY COALESCE(reference_id, id), started_at DESC
    )
    SELECT
      geo_city AS city, geo_region AS region, geo_country AS country,
      geo_lat AS lat, geo_lon AS lon, local_flag AS is_local,
      count(*)::int AS session_count,
      max(started_at) AS last_seen_at,
      array_agg(DISTINCT ip_address) AS ip_addresses
    FROM plays
    GROUP BY geo_city, geo_region, geo_country, geo_lat, geo_lon, local_flag
    ORDER BY max(started_at) DESC
  `);
  return (
    result.rows as {
      city: string | null;
      region: string | null;
      country: string | null;
      lat: number | null;
      lon: number | null;
      is_local: boolean;
      session_count: number;
      last_seen_at: Date;
      ip_addresses: string[];
    }[]
  ).map((loc) => ({
    city: loc.city,
    region: loc.region,
    country: loc.country,
    lat: loc.lat,
    lon: loc.lon,
    isLocal: loc.is_local,
    sessionCount: loc.session_count,
    lastSeenAt: loc.last_seen_at,
    ipAddresses: loc.ip_addresses ?? [],
  }));
}

interface DeviceSessionRow {
  device_id: string | null;
  dispatcharr_device_id?: string | null;
  player_name: string | null;
  product: string | null;
  device: string | null;
  platform: string | null;
  started_at: Date;
  geo_city: string | null;
  geo_region: string | null;
  geo_country: string | null;
  is_local: boolean;
}

type DeviceLocation = UserDevice['locations'][number];

function deviceLocationKey(session: DeviceSessionRow): string {
  return `${session.geo_city ?? ''}-${session.geo_region ?? ''}-${session.geo_country ?? ''}-${session.is_local}`;
}

function newDeviceLocation(session: DeviceSessionRow & { started_at: Date }) {
  return {
    city: session.geo_city,
    region: session.geo_region,
    country: session.geo_country,
    isLocal: session.is_local,
    sessionCount: 1,
    lastSeenAt: session.started_at,
  };
}

/**
 * Query deduplicated device sessions and aggregate into UserDevice[].
 * Uses DISTINCT ON to collapse pause/resume chains into one row per play,
 * then groups by device key with per-device location breakdowns.
 */
export async function queryUserDevices(
  dbOrTx: DbOrTx,
  serverUserIds: string | string[]
): Promise<UserDevice[]> {
  const ids = Array.isArray(serverUserIds) ? serverUserIds : [serverUserIds];
  const result = await dbOrTx.execute(sql`
    SELECT DISTINCT ON (COALESCE(reference_id, id))
      device_id, ${dispatcharrDeviceIdSql()} AS dispatcharr_device_id, player_name, product, device, platform, started_at,
      geo_city, geo_region, geo_country,
      ${localSessionSql('sessions')} AS is_local
    FROM sessions
    WHERE ${serverUserIdAnyFragment(ids)}
    ORDER BY COALESCE(reference_id, id), started_at DESC
  `);

  // Raw SQL returns timestamps as strings — coerce to Date for comparisons
  const sessionData = (result.rows as unknown as DeviceSessionRow[]).map((r) => ({
    ...r,
    started_at: new Date(r.started_at),
  }));

  const deviceMap = new Map<
    string,
    {
      deviceId: string | null;
      playerName: string | null;
      product: string | null;
      device: string | null;
      platform: string | null;
      sessionCount: number;
      lastSeenAt: Date;
      locationMap: Map<string, DeviceLocation>;
    }
  >();

  for (const session of sessionData) {
    const key =
      session.dispatcharr_device_id ??
      session.device_id ??
      session.player_name ??
      `${session.product ?? 'unknown'}-${session.device ?? 'unknown'}-${session.platform ?? 'unknown'}`;

    const existing = deviceMap.get(key);
    if (existing) {
      existing.sessionCount++;
      if (session.started_at > existing.lastSeenAt) {
        existing.lastSeenAt = session.started_at;
        existing.playerName = session.player_name ?? existing.playerName;
        existing.product = session.product ?? existing.product;
        existing.device = session.device ?? existing.device;
        existing.platform = session.platform ?? existing.platform;
      }

      const locKey = deviceLocationKey(session);
      const existingLoc = existing.locationMap.get(locKey);
      if (existingLoc) {
        existingLoc.sessionCount++;
        if (session.started_at > existingLoc.lastSeenAt) {
          existingLoc.lastSeenAt = session.started_at;
        }
      } else {
        existing.locationMap.set(locKey, newDeviceLocation(session));
      }
    } else {
      const locationMap = new Map<string, DeviceLocation>();
      locationMap.set(deviceLocationKey(session), newDeviceLocation(session));

      deviceMap.set(key, {
        deviceId: session.dispatcharr_device_id ?? session.device_id,
        playerName: session.player_name,
        product: session.product,
        device: session.device,
        platform: session.platform,
        sessionCount: 1,
        lastSeenAt: session.started_at,
        locationMap,
      });
    }
  }

  return Array.from(deviceMap.values())
    .map((dev) => ({
      deviceId: dev.deviceId,
      playerName: dev.playerName,
      product: dev.product,
      device: dev.device,
      platform: dev.platform,
      sessionCount: dev.sessionCount,
      lastSeenAt: dev.lastSeenAt,
      locations: Array.from(dev.locationMap.values()).sort(
        (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
      ),
    }))
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}
