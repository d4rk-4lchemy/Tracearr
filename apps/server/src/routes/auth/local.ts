/**
 * Local Authentication Routes
 *
 * POST /validate-claim-code - Validate a claim code for first-time setup
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validateClaimCode, isClaimCodeEnabled } from '../../utils/claimCode.js';

export const localRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /validate-claim-code - Validate claim code (stateless check)
   *
   * Validates the claim code without storing session.
   * Client uses this for immediate feedback before completing setup
   * through the Better Auth signup flow.
   */
  app.post('/validate-claim-code', async (request, reply) => {
    const body = z.object({ claimCode: z.string().min(1) }).safeParse(request.body);
    if (!body.success) {
      return reply.badRequest('Claim code is required');
    }

    const { claimCode } = body.data;

    if (!isClaimCodeEnabled()) {
      return reply.badRequest('Claim code validation not required');
    }

    if (!validateClaimCode(claimCode)) {
      return reply.forbidden('Invalid claim code');
    }

    return { success: true };
  });
};
