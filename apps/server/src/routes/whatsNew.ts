/**
 * What's-new routes (owner only)
 */

import type { FastifyPluginAsync } from 'fastify';
import { dismissWhatsNew, getWhatsNewState } from '../services/whatsNew.js';

export const whatsNewRoutes: FastifyPluginAsync = async (app) => {
  const readSettings = { preHandler: [app.requirePermission('settings', 'read')] };
  const writeSettings = { preHandler: [app.requirePermission('settings', 'write')] };
  app.get('/', readSettings, async (request, reply) => {
    if (request.user.role !== 'owner') {
      return reply.forbidden('Only the owner sees release notes');
    }
    return getWhatsNewState();
  });

  app.post('/dismiss', writeSettings, async (request, reply) => {
    if (request.user.role !== 'owner') {
      return reply.forbidden('Only the owner sees release notes');
    }
    await dismissWhatsNew();
    return reply.code(204).send();
  });
};
