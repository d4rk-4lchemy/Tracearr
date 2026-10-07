/**
 * The protections a third party can trip: a connect spends the shared v2
 * budget, no token means no admission, a rotated key closes the open
 * connection, and the handler never reaches the database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import type { Readable } from 'node:stream';
import type { SubscriberHandlers } from '../services/publicEvents/subscriber.js';

const { mockAdmit, subscriber } = vi.hoisted(() => ({
  mockAdmit: vi.fn(async () => true),
  subscriber: { handlers: null as null | SubscriberHandlers },
}));

vi.mock('../db/client.js', () => ({ db: { select: vi.fn(), execute: vi.fn() } }));
vi.mock('../services/settings.js', () => ({ getSetting: vi.fn(() => Promise.resolve(2)) }));
vi.mock('../services/publicEvents/registry.js', () => ({
  admitConnection: (...args: unknown[]) => mockAdmit(...(args as [])),
  touchConnections: vi.fn(async () => undefined),
  releaseConnection: vi.fn(async () => undefined),
}));
vi.mock('../services/publicEvents/subscriber.js', () => ({
  startSubscriber: vi.fn(async (_redis: unknown, handlers: SubscriberHandlers) => {
    subscriber.handlers = handlers;
    return true;
  }),
  stopSubscriber: vi.fn(() => {
    subscriber.handlers = null;
  }),
  subscriberRunning: () => subscriber.handlers !== null,
}));

import { db } from '../db/client.js';
import {
  closeAllPublicEventConnections,
  initPublicEventConnections,
  resetPublicEventConnectionsForTests,
} from '../services/publicEvents/connections.js';
import { publicV2Routes } from './publicV2/index.js';
import { translateChannelMessage } from './publicV2/eventsTranslate.js';
import { resetPublicApiRateLimitCache } from './publicV2/rateLimitCache.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  app.decorate('authenticatePublicApi', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;
    if (auth === 'Bearer trr_pub_owner') {
      request.publicApiContext = { userId: 'owner-1' };
      return;
    }
    return reply.unauthorized('Invalid API key');
  });
  await app.register(publicV2Routes, { prefix: '/api/v2/public' });
  initPublicEventConnections({
    redis: {} as never,
    log: app.log,
    translate: translateChannelMessage,
    getActiveSessions: async () => [],
    seedLastSeen: () => undefined,
    clearLastSeen: () => undefined,
  });
  return app;
}

// destroyOnReturn: false keeps the stream readable after the early break, so a
// test can read it again after closing the connection.
async function readUntil(stream: Readable, marker: string): Promise<string> {
  let text = '';
  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    text += String(chunk);
    if (text.includes(marker)) break;
  }
  return text;
}

const headers = { authorization: 'Bearer trr_pub_owner' };

describe('public events security', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetPublicApiRateLimitCache();
    resetPublicEventConnectionsForTests();
    mockAdmit.mockResolvedValue(true);
    app = await buildTestApp();
  });

  afterEach(async () => {
    closeAllPublicEventConnections('shutdown');
    await app.close();
  });

  it('never admits a connect without a valid key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/events' });
    expect(res.statusCode).toBe(401);
    expect(mockAdmit).not.toHaveBeenCalled();
  });

  it('a connect spends the shared v2 budget, so a reconnect storm hits 429 with Retry-After', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      headers,
      payloadAsStream: true,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    const second = await app.inject({
      method: 'GET',
      url: '/api/v2/public/streams?summary=true',
      headers,
    });
    expect(second.statusCode).toBe(200);
    const third = await app.inject({ method: 'GET', url: '/api/v2/public/events', headers });
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(mockAdmit).toHaveBeenCalledTimes(1);
  });

  it('a rotated key closes the open connection and the control message never reaches the client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      headers,
      payloadAsStream: true,
    });
    const stream = res.stream();
    await readUntil(stream, 'event: ready');
    expect(subscriber.handlers).not.toBeNull();

    subscriber.handlers?.onMessage({
      event: 'public-api:key-changed',
      data: { userId: 'owner-1' },
      at: 'x',
    });

    let rest = '';
    for await (const chunk of stream) rest += String(chunk);
    expect(rest).toBe('');
  });

  it('a rotated key for a different user leaves the connection open', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      headers,
      payloadAsStream: true,
    });
    const stream = res.stream();
    await readUntil(stream, 'event: ready');
    subscriber.handlers?.onMessage({
      event: 'public-api:key-changed',
      data: { userId: 'someone-else' },
      at: 'x',
    });
    subscriber.handlers?.onMessage({
      event: 'server:up',
      data: { serverId: 'srv-1', serverName: 'Attic' },
      at: 'x',
    });
    const text = await readUntil(stream, 'event: server.health');
    expect(text).toContain('"status":"up"');
    expect(text).not.toContain('key-changed');
  });

  it('a connect never touches the database', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      headers,
      payloadAsStream: true,
    });
    await readUntil(res.stream(), 'event: ready');
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled();
  });
});
