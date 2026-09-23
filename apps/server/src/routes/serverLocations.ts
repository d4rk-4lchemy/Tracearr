import type { FastifyPluginAsync } from 'fastify';
import {
  serverIdParamSchema,
  serverLocationsSchema,
  type UpdateServerLocationsResponse,
} from '@tracearr/shared';
import { enqueueServerLocationSyncIfBehind } from '../jobs/maintenanceQueue.js';
import { getServerLocations, replaceServerLocations } from '../services/serverLocations.js';
import { isCountryCode } from '../utils/country.js';
import { firstIssueMessage } from '../utils/zod.js';

export const serverLocationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/locations', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'owner') {
      return reply.forbidden('Only server owners can view server locations');
    }
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid server ID');

    const locations = await getServerLocations(params.data.id);
    if (!locations) return reply.notFound('Server not found');
    return locations;
  });

  app.put('/:id/locations', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'owner') {
      return reply.forbidden('Only server owners can update server locations');
    }
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid server ID');
    const body = serverLocationsSchema.safeParse(request.body);
    if (!body.success) return reply.badRequest(firstIssueMessage(body.error));

    const unknown = body.data.entries.find((entry) => !isCountryCode(entry.country));
    if (unknown) return reply.badRequest(`Unknown country code: ${unknown.country}`);

    const { id } = params.data;
    if (!(await getServerLocations(id))) return reply.notFound('Server not found');

    await replaceServerLocations(id, body.data.entries);
    let syncQueued = false;
    try {
      syncQueued = await enqueueServerLocationSyncIfBehind();
    } catch (err) {
      request.log.error({ err }, 'Could not queue the server location sync');
    }
    const saved = await getServerLocations(id);
    if (!saved) return reply.notFound('Server not found');
    const response: UpdateServerLocationsResponse = { ...saved, syncQueued };
    return response;
  });
};
