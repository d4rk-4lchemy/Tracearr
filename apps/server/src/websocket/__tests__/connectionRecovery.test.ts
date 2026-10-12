import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { WS_EVENTS } from '@tracearr/shared';

vi.mock('../../lib/sessionResolver.js', () => ({
  resolveBetterAuthSession: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

import { resolveBetterAuthSession } from '../../lib/sessionResolver.js';
import { initializeWebSocket } from '../index.js';

const resolveSession = vi.mocked(resolveBetterAuthSession);
let httpServer: HttpServer;
let io: ReturnType<typeof initializeWebSocket>;
let url: string;

function once<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (...args: unknown[]) => void));
}

beforeAll(async () => {
  httpServer = createServer();
  io = initializeWebSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await io.close();
});

beforeEach(() => {
  resolveSession.mockReset();
  resolveSession.mockResolvedValue({
    sessionId: 'ses1',
    user: { userId: 'u1', username: 'owner', role: 'owner', serverIds: ['s1'] },
  });
});

describe('reconnecting', () => {
  it('starts a fresh connection that runs auth and joins rooms from the current role', async () => {
    const client = connect(url, {
      auth: { token: 't' },
      reconnectionDelay: 10,
      reconnectionDelayMax: 20,
    });
    await once(client, 'connect');
    expect(await io.in('sessions').fetchSockets()).toHaveLength(1);

    const delivered = once(client, WS_EVENTS.SESSION_STOPPED);
    io.emit(WS_EVENTS.SESSION_STOPPED, 'sess-1');
    await delivered;

    resolveSession.mockResolvedValue({
      sessionId: 'ses1',
      user: { userId: 'u1', username: 'owner', role: 'member', serverIds: [] },
    });
    const reconnected = once(client, 'connect');
    client.io.engine.close();
    await reconnected;

    expect(client.recovered).toBeFalsy();
    expect(resolveSession).toHaveBeenCalledTimes(2);
    expect(await io.in('sessions').fetchSockets()).toHaveLength(0);
    expect(await io.in('member:u1').fetchSockets()).toHaveLength(1);
    client.disconnect();
  });
});

describe('handshake origin', () => {
  it('refuses a page from another origin and lets the app and native clients in', async () => {
    const foreign = connect(url, {
      auth: { token: 't' },
      reconnection: false,
      extraHeaders: { origin: 'http://localhost:1' },
    });
    await expect(once(foreign, 'connect_error')).resolves.toBeInstanceOf(Error);
    foreign.disconnect();

    for (const extraHeaders of [{ origin: url }, {}] as Record<string, string>[]) {
      const client = connect(url, { auth: { token: 't' }, reconnection: false, extraHeaders });
      await once(client, 'connect');
      client.disconnect();
    }
  });
});

describe('handshake host behind a proxy', () => {
  const forged = { origin: 'http://evil.example', 'x-forwarded-host': 'evil.example' };

  async function handshake(trustProxy: string | undefined) {
    vi.stubEnv('TRUST_PROXY', trustProxy ?? '');
    const client = connect(url, {
      auth: { token: 't' },
      reconnection: false,
      transports: ['polling'],
      extraHeaders: forged,
    });
    const outcome = await Promise.race([
      once(client, 'connect').then(() => 'connected'),
      once(client, 'connect_error').then(() => 'refused'),
    ]);
    client.disconnect();
    vi.unstubAllEnvs();
    return outcome;
  }

  it('believes x-forwarded-host only from a proxy TRUST_PROXY names', async () => {
    expect(await handshake(undefined)).toBe('refused');
    expect(await handshake('0')).toBe('refused');
    expect(await handshake('10.0.0.0/8')).toBe('refused');
    expect(await handshake('127.0.0.1, ::1')).toBe('connected');
  });

  it('answers a foreign preflight without credentialed CORS', async () => {
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://evil.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-forwarded-host',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();

    const own = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: { origin: url, 'access-control-request-method': 'GET' },
    });
    expect(own.headers.get('access-control-allow-origin')).toBe(url);
    expect(own.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
