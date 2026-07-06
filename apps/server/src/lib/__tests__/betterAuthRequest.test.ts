/**
 * toWebRequest() client IP forwarding tests
 *
 * Better Auth resolves the client IP solely from the x-tracearr-client-ip
 * header (advanced.ipAddress.ipAddressHeaders in lib/auth.ts), so the shim
 * must stamp it from Fastify's trustProxy-resolved request.ip on every
 * request. The security property under test: an inbound header of the same
 * name must never survive to Better Auth, or any client could pick its own
 * rate-limit bucket and forge session.ipAddress.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { toWebRequest } from '../betterAuthRequest.js';

const CLIENT_IP_HEADER = 'x-tracearr-client-ip';

function fakeRequest(overrides: {
  ip?: string | undefined;
  headers?: Record<string, string>;
}): FastifyRequest {
  return {
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    protocol: 'http',
    ip: overrides.ip,
    headers: { host: 'tracearr.example.com', ...overrides.headers },
    body: { email: 'a@b.c', password: 'x' },
  } as unknown as FastifyRequest;
}

describe('toWebRequest client ip header', () => {
  it('stamps x-tracearr-client-ip from request.ip', () => {
    const req = toWebRequest(fakeRequest({ ip: '203.0.113.9' }));
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.9');
  });

  it('overwrites an inbound spoofed x-tracearr-client-ip', () => {
    const req = toWebRequest(
      fakeRequest({
        ip: '203.0.113.9',
        headers: { [CLIENT_IP_HEADER]: '6.6.6.6' },
      })
    );
    expect(req.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.9');
  });

  it('drops an inbound x-tracearr-client-ip when request.ip is unavailable', () => {
    const req = toWebRequest(
      fakeRequest({
        ip: undefined,
        headers: { [CLIENT_IP_HEADER]: '6.6.6.6' },
      })
    );
    expect(req.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });

  it('keeps method, url and unrelated headers intact', () => {
    const req = toWebRequest(
      fakeRequest({ ip: '203.0.113.9', headers: { 'user-agent': 'probe/1' } })
    );
    expect(req.method).toBe('POST');
    expect(req.url).toBe('http://tracearr.example.com/api/v1/auth/sign-in/email');
    expect(req.headers.get('user-agent')).toBe('probe/1');
  });
});
