import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { configuredOrigins, registerOriginPolicy, trustProxyFromEnv } from '../origins.js';

describe('trustProxyFromEnv', () => {
  it('reads true as one hop: the proxy is trusted, the address it forwards is not', () => {
    const trust = trustProxyFromEnv('true');
    if (typeof trust !== 'function') throw new Error('expected a hop function');
    expect(trust('10.0.0.1', 0)).toBe(true);
    expect(trust('6.6.6.6', 1)).toBe(false);
  });

  it('reads digits as a hop count', () => {
    const trust = trustProxyFromEnv('2');
    if (typeof trust !== 'function') throw new Error('expected a hop function');
    expect(trust('10.0.0.2', 1)).toBe(true);
    expect(trust('6.6.6.6', 2)).toBe(false);
  });

  it('trusts only the listed proxies, IPv4-mapped peers included', () => {
    const trust = trustProxyFromEnv('10.0.0.0/8, 127.0.0.1, fd00::/8');
    if (typeof trust !== 'function') throw new Error('expected a trust function');
    expect(trust('10.1.2.3', 0)).toBe(true);
    expect(trust('::ffff:127.0.0.1', 0)).toBe(true);
    expect(trust('fd00::1', 1)).toBe(true);
    expect(trust('192.168.1.5', 0)).toBe(false);
  });

  it('stops startup on a list entry that is not an address or CIDR, naming the variable', () => {
    expect(() => trustProxyFromEnv('yes')).toThrow(/^TRUST_PROXY: "yes"/);
    expect(() => trustProxyFromEnv('10.0.0.0/33')).toThrow(/TRUST_PROXY/);
    expect(() => trustProxyFromEnv('proxy.lan')).toThrow(/TRUST_PROXY/);
    for (const value of [
      '10.0.0.1/',
      '10.0.0.1/-0',
      '10.0.0.0/8/9',
      '10.0.0.0/0x8',
      '10.0.0.0/ 8',
      '::1/129',
    ]) {
      expect(() => trustProxyFromEnv(value), value).toThrow(/TRUST_PROXY/);
    }
  });

  it('reads true and false in any case, and trusts nothing when unset, false or 0', () => {
    expect(typeof trustProxyFromEnv('TRUE')).toBe('function');
    expect(typeof trustProxyFromEnv('True')).toBe('function');
    for (const value of [undefined, '', 'false', 'FALSE', '0']) {
      expect(trustProxyFromEnv(value)).toBe(false);
    }
  });
});

describe('origin policy', () => {
  let app: FastifyInstance;

  async function build(corsOrigin?: string) {
    vi.stubEnv('CORS_ORIGIN', corsOrigin ?? '');
    app = Fastify({ logger: false });
    await registerOriginPolicy(app);
    app.post('/owner-write', async () => ({ ok: true }));
    app.get('/read', async () => ({ ok: true }));
    await app.ready();
  }

  function write(headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/owner-write',
      headers: { host: 'tracearr.lan:3000', cookie: 'session_token=abc', ...headers },
    });
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('refuses a cookie write from another port or a sibling subdomain', async () => {
    await build();
    for (const origin of ['http://tracearr.lan:8080', 'https://other.tracearr.lan']) {
      expect((await write({ origin })).statusCode).toBe(403);
    }
    expect((await write({ 'sec-fetch-site': 'same-site' })).statusCode).toBe(403);
  });

  it("accepts a cookie write from the app's own origin, either scheme, or a configured one", async () => {
    await build('http://localhost:5173');
    expect((await write({ origin: 'http://tracearr.lan:3000' })).statusCode).toBe(200);
    expect((await write({ origin: 'https://tracearr.lan:3000' })).statusCode).toBe(200);
    expect((await write({ origin: 'http://localhost:5173' })).statusCode).toBe(200);
    expect((await write({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200);
  });

  it('leaves requests that carry their own credential, or no cookie, alone', async () => {
    await build();
    const origin = 'https://evil.example';
    expect((await write({ origin, authorization: 'Bearer trr_key' })).statusCode).toBe(200);
    expect((await write({ origin, authorization: 'Basic eDp4' })).statusCode).toBe(403);
    const noCookie = await app.inject({ method: 'POST', url: '/owner-write', headers: { origin } });
    expect(noCookie.statusCode).toBe(200);
  });

  it('never grants a credentialed CORS read to an origin it does not trust, * included', async () => {
    await build('*');
    const res = await app.inject({
      method: 'GET',
      url: '/read',
      headers: { host: 'tracearr.lan:3000', origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(configuredOrigins()).toEqual([]);

    const own = await app.inject({
      method: 'GET',
      url: '/read',
      headers: { host: 'tracearr.lan:3000', origin: 'http://tracearr.lan:3000' },
    });
    expect(own.headers['access-control-allow-origin']).toBe('http://tracearr.lan:3000');
    expect(own.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers to an untrusted origin when CORS_ORIGIN is unset', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/read',
      headers: { host: 'tracearr.lan:3000', origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
