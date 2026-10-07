/**
 * Public API v2 - GET /servers
 *
 * Every configured media server with the reachability Tracearr knows. A
 * server with a live event connection is up and never polled, so its health
 * key is absent or stale and is ignored. Any other connection state hands the
 * server to the poller, whose health key then decides. A historical server is
 * never contacted and reads nothing.
 */

import type { ServerConnectionStatus } from '@tracearr/shared';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { servers } from '../../db/schema.js';
import { getCacheService } from '../../services/cache.js';
import { getCurrentVersion } from '../../utils/buildInfo.js';
import { serverOrderBy } from '../../utils/serverOrder.js';
import type { RouteConfig } from './shared.js';

// Exhaustive so a new connection state has to say whether the poller covers it
function hasLiveConnection(connection: ServerConnectionStatus | null): boolean {
  switch (connection?.state) {
    case 'connected':
      return true;
    case 'connecting':
    case 'reconnecting':
    case 'disconnected':
    case 'fallback':
    case 'unsupported':
    case undefined:
      return false;
  }
}

export function registerServersRoutes(app: FastifyInstance, routeConfig: RouteConfig): void {
  app.get(
    '/servers',
    { preHandler: [app.authenticatePublicApi], config: routeConfig },
    async () => {
      const rows = await db
        .select({
          id: servers.id,
          name: servers.name,
          type: servers.type,
          version: servers.version,
          historicalAt: servers.historicalAt,
        })
        .from(servers)
        .orderBy(...serverOrderBy());

      const cache = getCacheService();
      const activeSessions = cache ? await cache.getAllActiveSessions() : [];

      const data = await Promise.all(
        rows.map(async (server) => {
          const historical = server.historicalAt !== null;
          const live =
            cache && !historical
              ? hasLiveConnection(await cache.getServerConnectionStatus(server.id))
              : false;
          const polled =
            cache && !historical && !live ? await cache.getServerHealth(server.id) : null;
          const status = live || polled ? 'up' : polled === null ? 'unknown' : 'down';
          const reason =
            cache && status === 'down' ? await cache.getServerDownReason(server.id) : null;
          return {
            server_id: server.id,
            server_name: server.name,
            status,
            reason,
            server_type: server.type,
            historical,
            active_streams: activeSessions.filter((s) => s.serverId === server.id).length,
            version: server.version,
          };
        })
      );

      return { data, tracearr_version: getCurrentVersion() };
    }
  );
}
