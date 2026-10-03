/**
 * The one place that spells "Tracearr may still contact this server". Every
 * path that reaches a media server reads through here; everything that reads
 * history keeps reading all servers.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';

export type ServerRow = typeof servers.$inferSelect;

export const HISTORICAL_EDIT_MESSAGE = 'Resume this server to change its address or key';

export const HISTORICAL_IMPORT_MESSAGE = 'Resume this server to import into it';

export const liveServerCondition = isNull(servers.historicalAt);

export function isLiveRow(row: { historicalAt?: Date | null }): boolean {
  return !row.historicalAt;
}

export async function liveServers(): Promise<ServerRow[]> {
  return db.select().from(servers).where(liveServerCondition);
}

export async function isLiveServer(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, id), liveServerCondition))
    .limit(1);
  return row !== undefined;
}

export class ServerHistoricalError extends Error {
  readonly serverId: string;

  constructor(serverId: string) {
    super(`Server ${serverId} is historical`);
    this.name = 'ServerHistoricalError';
    this.serverId = serverId;
  }
}
