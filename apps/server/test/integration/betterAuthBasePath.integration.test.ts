/**
 * OIDC redirect_uri under BASE_PATH (integration, #926).
 *
 * With BASE_PATH set, the redirect_uri sent to the OIDC provider dropped the
 * subpath and the provider rejected the authorization request as
 * unregistered. This drives a real Better Auth instance with the
 * genericOAuth plugin through the production shim (createBetterAuthHandler)
 * behind the same rewriteUrl as index.ts, and asserts on the authorization
 * URL the sign-in endpoint returns. authorizationUrl/tokenUrl are set
 * directly instead of production's discoveryUrl so no network fetch is
 * involved; the redirect_uri construction under test is the same for both.
 *
 * BASE_PATH is process-wide, so it is set in beforeAll and removed in
 * afterAll. getBasePath() resolves on first call, which happens inside
 * beforeAll here.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { username as usernamePlugin, genericOAuth } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { API_BASE_PATH } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { users, authAccounts, authSessions, authVerifications } from '../../src/db/schema.js';
import { createBetterAuthHandler } from '../../src/lib/betterAuthRequest.js';
import { betterAuthBasePath } from '../../src/lib/basePath.js';

const HOST = 'tracearr.example.com';
const BASE_PATH = '/tracearr';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.BASE_PATH = BASE_PATH;

  // basePath comes from the production helper; requests flow through the
  // production shim.
  const auth = betterAuth({
    basePath: betterAuthBasePath(),
    secret: 'test-better-auth-secret-32-chars!!',
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
    },
    plugins: [
      usernamePlugin(),
      genericOAuth({
        config: [
          {
            providerId: 'oidc',
            clientId: 'tracearr',
            clientSecret: 'test-oidc-secret',
            authorizationUrl: 'https://idp.example.com/authorize',
            tokenUrl: 'https://idp.example.com/token',
            scopes: ['openid', 'email', 'profile'],
            pkce: true,
          },
        ],
      }),
    ],
  });

  app = Fastify({
    logger: false,
    // Mirrors the rewriteUrl in index.ts with BASE_PATH set.
    rewriteUrl(req) {
      const url = req.url ?? '/';
      if (url.startsWith(`${BASE_PATH}/`) || url === BASE_PATH) {
        return url.slice(BASE_PATH.length) || '/';
      }
      return url;
    },
  });
  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    handler: createBetterAuthHandler(() => auth),
  });
  await app.ready();
});

afterAll(async () => {
  delete process.env.BASE_PATH;
  await app.close();
});

async function signInOAuth2(url: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      host: HOST,
      'x-forwarded-proto': 'https',
    },
    payload: { providerId: 'oidc', callbackURL: `${BASE_PATH}/` },
  });
}

describe('OIDC redirect_uri with BASE_PATH set', () => {
  it('keeps the subpath in the redirect_uri sent to the provider', async () => {
    const res = await signInOAuth2(`${BASE_PATH}${API_BASE_PATH}/auth/sign-in/oauth2`);
    expect(res.statusCode).toBe(200);

    const authorizationUrl = new URL(res.json().url);
    expect(authorizationUrl.origin).toBe('https://idp.example.com');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      `https://${HOST}${BASE_PATH}${API_BASE_PATH}/auth/oauth2/callback/oidc`
    );
  });

  it('emits the same canonical redirect_uri for a request that bypasses the prefix', async () => {
    // Direct access without the subpath (rewriteUrl passes it through
    // untouched) must send the redirect_uri the provider has registered.
    const res = await signInOAuth2(`${API_BASE_PATH}/auth/sign-in/oauth2`);
    expect(res.statusCode).toBe(200);

    expect(new URL(res.json().url).searchParams.get('redirect_uri')).toBe(
      `https://${HOST}${BASE_PATH}${API_BASE_PATH}/auth/oauth2/callback/oidc`
    );
  });
});
