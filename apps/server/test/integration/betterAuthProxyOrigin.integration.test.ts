/**
 * Reverse-proxy origin derivation for the Better Auth Fastify shim (integration)
 *
 * The app never sets baseURL on Better Auth, so Better Auth derives its
 * per-request trusted origin from the URL the Fastify wildcard shim builds
 * (lib/betterAuthRequest.ts). Behind a TLS-terminating reverse proxy the
 * browser sends Origin: https://host; if the shim builds an http:// URL the
 * derived trusted origin is http://host and every cookie-bearing
 * state-changing request fails the origin check with 403 INVALID_ORIGIN,
 * which breaks login for the documented production setup when CORS_ORIGIN is
 * unset.
 *
 * NODE_ENV=test makes Better Auth default advanced.disableOriginCheck to
 * true, so this file builds a disposable auth instance with the check forced
 * on (same pattern as betterAuthSecurity.integration.test.ts) and, unlike
 * that file, drives it through the mounted Fastify wildcard route so the
 * shim's URL construction is the thing under test. trustedOrigins is left
 * empty to match a deployment without CORS_ORIGIN: the request-derived
 * origin is the only trusted one.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { API_BASE_PATH } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { users, authAccounts, authSessions, authVerifications } from '../../src/db/schema.js';
import { createBetterAuthHandler } from '../../src/lib/betterAuthRequest.js';

const HOST = 'tracearr.example.com';

const originCheckAuth = betterAuth({
  basePath: '/api/v1/auth',
  secret: 'test-better-auth-secret-32-chars!!',
  trustedOrigins: [],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),
  advanced: {
    database: { generateId: () => randomUUID() },
    disableOriginCheck: false,
  },
  emailAndPassword: { enabled: true },
});

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    handler: createBetterAuthHandler(() => originCheckAuth),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function signIn(headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: `${API_BASE_PATH}/auth/sign-in/email`,
    headers: {
      'content-type': 'application/json',
      cookie: 'session-probe=1',
      host: HOST,
      ...headers,
    },
    payload: { email: 'nobody@example.com', password: 'WrongPassword!123' },
  });
}

describe('better auth shim origin derivation behind a reverse proxy', () => {
  it('passes the origin gate for proxied HTTPS (x-forwarded-proto: https)', async () => {
    const res = await signIn({
      'x-forwarded-proto': 'https',
      origin: `https://${HOST}`,
    });
    // 401 means the request got past the origin check to the real
    // credential check; the bug manifests as 403 INVALID_ORIGIN here.
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('passes the origin gate when x-forwarded-proto carries multiple values', async () => {
    const res = await signIn({
      'x-forwarded-proto': 'https, http',
      origin: `https://${HOST}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('still rejects a cross-site origin on a proxied HTTPS request', async () => {
    const res = await signIn({
      'x-forwarded-proto': 'https',
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INVALID_ORIGIN');
  });

  it('still passes the origin gate for a plain http request with matching origin', async () => {
    const res = await signIn({
      origin: `http://${HOST}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('falls back to the request protocol when x-forwarded-proto is garbage', async () => {
    const res = await signIn({
      'x-forwarded-proto': 'evil://',
      origin: `http://${HOST}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });
});
