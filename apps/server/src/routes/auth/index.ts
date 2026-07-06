/**
 * Authentication Routes Module
 *
 * Orchestrates all auth-related routes and provides unified export.
 *
 * Auth Flow Options:
 * - Better Auth handles local signup/login and Plex OAuth (mounted separately
 *   in index.ts as the /auth/* wildcard).
 * - POST /validate-claim-code → Stateless claim code check used during setup
 *
 * Server Connection (separate from auth):
 * - POST /plex/connect → Connect a Plex server after login
 * - POST /jellyfin/connect-api-key → Connect a Jellyfin server after login
 * - POST /emby/connect-api-key → Connect an Emby server after login
 *
 * Session Management:
 * - GET /me → Get current user info
 */

import type { FastifyPluginAsync } from 'fastify';
import { localRoutes } from './local.js';
import { plexRoutes } from './plex.js';
import { jellyfinRoutes } from './jellyfin.js';
import { embyRoutes } from './emby.js';
import { sessionRoutes } from './session.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Register all sub-route plugins
  // Each plugin defines its own paths (no additional prefix needed)
  await app.register(localRoutes);
  await app.register(plexRoutes);
  await app.register(jellyfinRoutes);
  await app.register(embyRoutes);
  await app.register(sessionRoutes);
};
