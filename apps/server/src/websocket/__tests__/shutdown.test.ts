import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { io as connect } from 'socket.io-client';

vi.mock('../../lib/sessionResolver.js', () => ({
  resolveBetterAuthSession: vi.fn().mockResolvedValue({
    sessionId: undefined,
    user: { userId: 'u1', username: 'owner', role: 'owner', serverIds: ['s1'] },
  }),
}));

vi.mock('../../db/client.js', () => ({ db: { select: vi.fn() } }));

import { disconnectAllSockets, initializeWebSocket } from '../index.js';

describe('disconnectAllSockets', () => {
  it('lets app.close() reach onClose while a websocket client is connected', async () => {
    const app = Fastify();
    const io = initializeWebSocket(app.server);
    app.addHook('preClose', async () => {
      disconnectAllSockets();
    });
    let onCloseRan = false;
    app.addHook('onClose', async () => {
      onCloseRan = true;
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const client = connect(`http://127.0.0.1:${port}`, {
      auth: { token: 't' },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));

    void app.close();
    await Promise.race([
      (async () => {
        while (!onCloseRan) await sleep(10);
      })(),
      sleep(2000),
    ]);

    const ranBeforeCleanup = onCloseRan;
    client.disconnect();
    await io.close();
    expect(ranBeforeCleanup).toBe(true);
  });
});
