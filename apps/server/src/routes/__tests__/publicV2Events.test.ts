/**
 * GET /api/v2/public/events. The subscriber and registry are mocked; the
 * real connections module runs so headers, the retry field, ready and the
 * shutdown close are exercised end to end over inject's stream.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

const { mockAdmit, mockRelease } = vi.hoisted(() => ({
  mockAdmit: vi.fn(async () => true),
  mockRelease: vi.fn(async () => undefined),
}));

vi.mock('../../db/client.js', () => ({ db: { select: vi.fn(), execute: vi.fn() } }));
vi.mock('../../services/settings.js', () => ({ getSetting: vi.fn(() => Promise.resolve(240)) }));
vi.mock('../../services/publicEvents/registry.js', () => ({
  admitConnection: (...args: unknown[]) => mockAdmit(...(args as [])),
  touchConnections: vi.fn(async () => undefined),
  releaseConnection: (...args: unknown[]) => mockRelease(...(args as [])),
}));
vi.mock('../../services/publicEvents/subscriber.js', () => ({
  startSubscriber: vi.fn(async () => true),
  stopSubscriber: vi.fn(),
  subscriberRunning: () => false,
}));

import { db } from '../../db/client.js';
import {
  MAX_CONNECTIONS_PER_INSTANCE,
  attachPublicEventConnection,
  closeAllPublicEventConnections,
  getPublicEventConnectionStats,
  initPublicEventConnections,
  resetPublicEventConnectionsForTests,
  type ConnectionSink,
} from '../../services/publicEvents/connections.js';
import { publicV2Routes } from '../publicV2/index.js';
import { translateChannelMessage } from '../publicV2/eventsTranslate.js';
import { resetPublicApiRateLimitCache } from '../publicV2/rateLimitCache.js';

// The raw request of the most recent inject, so a test can destroy it mid-handler.
let lastRequest: IncomingMessage | null = null;

function fakeSink(): ConnectionSink {
  return {
    write: () => true,
    end: () => undefined,
    destroy: () => undefined,
    writableLength: 0,
    writableEnded: false,
    on: () => undefined,
  };
}

async function fillInstance(): Promise<void> {
  const open = getPublicEventConnectionStats().open;
  for (let i = open; i < MAX_CONNECTIONS_PER_INSTANCE; i += 1) {
    await attachPublicEventConnection({
      connId: `filler-${i}`,
      userId: 'filler',
      ip: '127.0.0.1',
      types: new Set(['server.health' as const]),
      serverId: null,
      sink: fakeSink(),
    });
  }
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.addHook('onRequest', async (request) => {
    lastRequest = request.raw;
  });
  app.decorate('authenticatePublicApi', async (request: FastifyRequest, _reply: FastifyReply) => {
    request.publicApiContext = { userId: 'u1' };
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

describe('GET /api/v2/public/events', () => {
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

  it('rejects a bad type or server id with 400 before opening anything', async () => {
    const badType = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events?types=stream.nope',
    });
    expect(badType.statusCode).toBe(400);
    const badServer = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events?server_id=abc',
    });
    expect(badServer.statusCode).toBe(400);
    expect(mockAdmit).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After when the key is at its cap', async () => {
    mockAdmit.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/events' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toMatchObject({ message: expect.stringContaining('20') });
  });

  it('answers 503 and releases nothing when admission cannot reach Redis', async () => {
    mockAdmit.mockRejectedValueOnce(new Error('redis down'));
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/events' });
    expect(res.statusCode).toBe(503);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('gives the slot back and answers 429 when the instance filled up during admission', async () => {
    mockAdmit.mockImplementationOnce(async () => {
      await fillInstance();
      return true;
    });
    const res = await app.inject({ method: 'GET', url: '/api/v2/public/events' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(mockRelease).toHaveBeenCalledWith({}, 'u1', expect.any(String));
    expect(getPublicEventConnectionStats().open).toBe(MAX_CONNECTIONS_PER_INSTANCE);
  });

  it('gives the slot back and attaches nothing when the client left during admission', async () => {
    mockAdmit.mockImplementationOnce(async () => {
      lastRequest?.destroy();
      return true;
    });
    await expect(app.inject({ method: 'GET', url: '/api/v2/public/events' })).rejects.toMatchObject(
      { code: 'LIGHT_ECONNRESET' }
    );
    await vi.waitFor(() => expect(mockRelease).toHaveBeenCalledWith({}, 'u1', expect.any(String)));
    expect(getPublicEventConnectionStats().open).toBe(0);
  });

  it('opens a connection with the SSE headers, the retry field and a ready event, touching no DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      payloadAsStream: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const text = await readUntil(res.stream(), 'event: ready');
    expect(text.startsWith('retry: 5000\n\n')).toBe(true);
    expect(text).toMatch(
      /event: ready\ndata: \{"type":"ready","at":"\d{4}-\d{2}-\d{2}T[^"]+","data":\{\}\}\n\n/
    );
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled();
  });

  it('ignores a Last-Event-ID header: no replay, just ready', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      headers: { 'last-event-id': '12345-0' },
      payloadAsStream: true,
    });
    const text = await readUntil(res.stream(), 'event: ready');
    expect(text.split('\n\n').filter(Boolean)).toHaveLength(2);
  });

  it('ends the response when every connection is closed for shutdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/public/events',
      payloadAsStream: true,
    });
    const stream = res.stream();
    await readUntil(stream, 'event: ready');
    closeAllPublicEventConnections('shutdown');
    let rest = '';
    for await (const chunk of stream) rest += String(chunk);
    expect(rest).toBe('');
    expect(mockRelease).toHaveBeenCalledWith({}, 'u1', expect.any(String));
  });
});
