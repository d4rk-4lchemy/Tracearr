/**
 * Client IP forwarding into Better Auth (integration)
 *
 * Fastify resolves the client address (honoring trustProxy) into request.ip;
 * the wildcard shim stamps it into x-tracearr-client-ip and lib/auth.ts tells
 * Better Auth to trust only that header. These tests drive the REAL mounted
 * handler + REAL auth instance against the test Postgres/Redis and assert the
 * two consumer-visible effects of that chain:
 *
 * 1. session.ipAddress records the proxy-forwarded client IP, not the
 *    localhost fallback (and a client-sent x-tracearr-client-ip cannot forge
 *    it).
 * 2. Rate limiting buckets per client IP: one hostile client exhausting the
 *    3-per-10s sign-in rule must not starve a different client, which is
 *    exactly what happens when every request collapses into the shared
 *    no-trusted-ip bucket.
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { API_BASE_PATH } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { authSessions } from '../../src/db/schema.js';
import { closeAuth } from '../../src/lib/auth.js';
import { createBetterAuthHandler } from '../../src/lib/betterAuthRequest.js';
import { getRedis } from '../../src/lib/redisShared.js';

// trustProxy: true mirrors the documented reverse-proxy deployment
// (TRUST_PROXY=true), making request.ip honor x-forwarded-for.
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  app.route({
    method: ['GET', 'POST'],
    url: `${API_BASE_PATH}/auth/*`,
    handler: createBetterAuthHandler(),
  });
  await app.ready();
  return app;
}

async function signUp(app: FastifyInstance, headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: `${API_BASE_PATH}/auth/sign-up/email`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: {
      email: 'ip-owner@example.com',
      password: 'IpOwner!1234567',
      name: 'Ip Owner',
      username: 'ipowner',
    },
  });
}

// A proxy chain appends to x-forwarded-for, so the header reaching the app is
// multi-valued. Better Auth's own header parsing rejects multi-valued XFF
// outright when no trustedProxies are configured; only Fastify's trustProxy
// resolution (forwarded through the shim) can recover the client IP here.
const proxyChain = (ip: string) => `${ip}, 10.0.0.1`;

async function signIn(app: FastifyInstance, ip: string) {
  return app.inject({
    method: 'POST',
    url: `${API_BASE_PATH}/auth/sign-in/email`,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': proxyChain(ip) },
    payload: { email: 'nobody@example.com', password: 'WrongPassword!123' },
  });
}

describe('better auth client ip forwarding (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    // Sign-ups mint sessions and sign-ins mint rate-limit counters in the
    // shared test Redis; clear only this suite's Better Auth keys so the
    // redis-prefix canary and back-to-back integration runs stay clean.
    const redis = getRedis();
    const baKeys = await redis.keys(`${process.env.REDIS_PREFIX ?? ''}tracearr:ba:*`);
    if (baKeys.length > 0) {
      await redis.del(...baKeys);
    }
    await closeAuth();
  });

  it('records the proxy-forwarded client ip on the created session', async () => {
    const res = await signUp(app, { 'x-forwarded-for': proxyChain('198.51.100.7') });
    expect(res.statusCode).toBe(200);

    const rows = await db.select().from(authSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ipAddress).toBe('198.51.100.7');
  });

  it('ignores a client-sent x-tracearr-client-ip header', async () => {
    const res = await signUp(app, { 'x-tracearr-client-ip': '6.6.6.6' });
    expect(res.statusCode).toBe(200);

    const rows = await db.select().from(authSessions);
    expect(rows).toHaveLength(1);
    // No x-forwarded-for, so the client is the socket peer (127.0.0.1 for
    // injected requests). The spoofed header must not leak through.
    expect(rows[0]!.ipAddress).toBe('127.0.0.1');
  });

  it('rate limits sign-in per client ip instead of one shared bucket', async () => {
    const hostile = '203.0.113.101';
    const bystander = '203.0.113.102';

    for (let i = 0; i < 3; i++) {
      const res = await signIn(app, hostile);
      expect(res.statusCode).not.toBe(429);
    }
    const fourth = await signIn(app, hostile);
    expect(fourth.statusCode).toBe(429);

    const other = await signIn(app, bystander);
    expect(other.statusCode).not.toBe(429);
  });
});
