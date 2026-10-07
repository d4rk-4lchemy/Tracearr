/**
 * Public API v2 - GET /events (server-sent events)
 *
 * Auth and the shared v2 rate limit run as preHandlers like every other v2
 * route, so a connect costs one unit of the key's budget. After that the
 * request never touches the DB: admission is one Redis script, and live
 * events come from the process-wide subscriber. There is no replay; the
 * first event is ready, and the client refetches state over REST.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  MAX_CONNECTIONS_PER_KEY,
  OVER_CAP_RETRY_AFTER_S,
  admitPublicEventConnection,
  attachPublicEventConnection,
  instanceHasRoom,
  releaseAdmission,
} from '../../services/publicEvents/connections.js';
import { PUBLIC_EVENT_TYPES, type PublicEventType } from './eventsTranslate.js';
import type { RouteConfig } from './shared.js';

const typesSchema = z
  .string()
  .transform((raw) =>
    raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.enum(PUBLIC_EVENT_TYPES)).min(1).max(PUBLIC_EVENT_TYPES.length));

const eventsQuerySchema = z.object({
  types: typesSchema.optional(),
  server_id: z.uuid().optional(),
});

function overCap(reply: FastifyReply, message: string) {
  reply.header('Retry-After', String(OVER_CAP_RETRY_AFTER_S));
  return reply.tooManyRequests(message);
}

export function registerEventsRoutes(app: FastifyInstance, routeConfig: RouteConfig): void {
  app.get(
    '/events',
    { preHandler: [app.authenticatePublicApi], config: routeConfig },
    async (request, reply) => {
      const query = eventsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.badRequest('Invalid query parameters');
      }
      const context = request.publicApiContext;
      if (!context) {
        return reply.unauthorized('Missing or invalid Authorization header');
      }

      const types: ReadonlySet<PublicEventType> = new Set(query.data.types ?? PUBLIC_EVENT_TYPES);
      const serverId = query.data.server_id ?? null;
      const connId = randomUUID();

      let admission: Awaited<ReturnType<typeof admitPublicEventConnection>>;
      try {
        admission = await admitPublicEventConnection(context.userId, connId);
      } catch (err) {
        request.log.warn({ err }, 'public event connection admission failed');
        return reply.serviceUnavailable('Live events are unavailable');
      }
      if (admission === 'key_cap') {
        return overCap(
          reply,
          `This API key already has ${MAX_CONNECTIONS_PER_KEY} open event connections`
        );
      }
      if (admission === 'instance_cap') {
        return overCap(reply, 'This server has no room for another event connection');
      }

      // The admission await is a window: other connects may have filled this
      // process, and the client may have gone. Both must give the slot back.
      if (request.raw.destroyed) {
        await releaseAdmission(context.userId, connId);
        reply.hijack();
        return;
      }
      if (!instanceHasRoom()) {
        await releaseAdmission(context.userId, connId);
        return overCap(reply, 'This server has no room for another event connection');
      }

      reply.hijack();
      const res = reply.raw;
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) res.setHeader(name, value);
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      });
      // light-my-request's socket has neither method, so both calls are optional.
      request.raw.socket.setKeepAlive?.(true, 30_000);
      request.raw.socket.setNoDelay?.(true);

      await attachPublicEventConnection({
        connId,
        userId: context.userId,
        ip: request.ip,
        types,
        serverId,
        sink: res,
      });
    }
  );
}
