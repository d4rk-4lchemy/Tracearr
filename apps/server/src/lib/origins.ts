/**
 * Which browser origins may act with a Tracearr session cookie, and which proxies Tracearr
 * believes about the client address and host.
 *
 * The web app is served from the API's own origin, so a cookie-bearing write is accepted from
 * that origin (either scheme, for HTTPS proxies that do not forward x-forwarded-proto) and from
 * the origins listed in CORS_ORIGIN. A page on another port of the same host or on a sibling
 * subdomain is same-site, so the Lax session cookie rides along on its requests; the Origin
 * check is what refuses them.
 */

import { BlockList, isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type TrustProxy = (address: string, hop: number) => boolean;

/** proxy-addr hands Fastify IPv4 peers in their IPv6-mapped form. */
function unmapped(address: string): string {
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

/**
 * Fastify's trustProxy from TRUST_PROXY, case-insensitive. "true" is one hop, the usual single
 * reverse proxy, so the client address is the right-most x-forwarded-for entry that proxy
 * appended and anything a client wrote to the left of it is ignored. Digits are a hop count, and
 * 0 or "false" trusts nothing. Anything else must be a comma-separated list of proxy IPs or CIDR
 * ranges; one that is neither stops startup. Fastify 5.12 treats a bare number as trusting
 * nothing, so every form goes in as a function, which the socket handshake uses too.
 */
export function trustProxyFromEnv(value = process.env.TRUST_PROXY): false | TrustProxy {
  const setting = value?.trim().toLowerCase();
  if (!setting || setting === 'false' || setting === '0') return false;
  const hops = setting === 'true' ? 1 : /^\d+$/.test(setting) ? Number(setting) : null;
  if (hops !== null) return (_address, hop) => hop < hops;

  const proxies = new BlockList();
  for (const entry of setting.split(',').map((part) => part.trim())) {
    const [address = '', prefix, ...extra] = entry.split('/');
    const family = isIP(address);
    // Number('') and Number('-0') are 0, which would trust every peer.
    const bits = prefix === undefined || !/^\d{1,3}$/.test(prefix) ? undefined : Number(prefix);
    const maxBits = family === 6 ? 128 : 32;
    if (
      !family ||
      extra.length > 0 ||
      (prefix !== undefined && (bits === undefined || bits > maxBits))
    ) {
      throw new Error(
        `TRUST_PROXY: "${entry}" is not an IP address or CIDR range. Use true, a hop count, or a comma-separated list of proxy IPs/CIDRs.`
      );
    }
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) proxies.addAddress(address, type);
    else proxies.addSubnet(address, bits, type);
  }
  return (address) => {
    const peer = unmapped(address);
    const family = isIP(peer);
    return !!family && proxies.check(peer, family === 6 ? 'ipv6' : 'ipv4');
  };
}

/**
 * The host a handshake was addressed to, read the way Fastify's request.host reads it:
 * x-forwarded-host (its last entry) only from a peer TRUST_PROXY trusts, else Host.
 */
export function requestHost(req: {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined };
}): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const peer = req.socket.remoteAddress;
  const trust = trustProxyFromEnv();
  if (typeof forwarded === 'string' && trust && peer && trust(peer, 0)) {
    return forwarded.split(',').pop()?.trim();
  }
  const host = req.headers.host;
  return typeof host === 'string' ? host : undefined;
}

function corsEntries(): string[] {
  return (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** CORS_ORIGIN's explicit origins. A wildcard never grants a cookie, so it is not one of them. */
export function configuredOrigins(): string[] {
  return corsEntries().filter((entry) => !entry.includes('*'));
}

/** CORS_ORIGIN=* lets any page read responses to requests that carry no cookie. */
export function corsAllowsAnyOrigin(): boolean {
  return corsEntries().includes('*');
}

export function isTrustedOrigin(origin: string, host: string | undefined): boolean {
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
  return configuredOrigins().includes(origin);
}

interface RequestShape {
  method: string;
  host?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A write that rides on the session cookie from a page Tracearr does not serve. Requests with
 * a Bearer Authorization header (API keys, session tokens, the mobile app) carry their own credential,
 * which a browser never attaches on its own. A request with no Origin and no Sec-Fetch-Site did
 * not come from a browser page.
 */
export function isCrossSiteCookieWrite(request: RequestShape): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  // Bearer is the only scheme Tracearr reads; any other header exempts nothing.
  const authorization = request.headers.authorization;
  if (!request.headers.cookie) return false;
  if (typeof authorization === 'string' && /^bearer /i.test(authorization)) return false;
  const origin = request.headers.origin;
  if (typeof origin === 'string') return !isTrustedOrigin(origin, request.host);
  const site = request.headers['sec-fetch-site'];
  return typeof site === 'string' && site !== 'same-origin' && site !== 'none';
}

/** CORS for the API and the refusal of cross-site cookie writes. */
export async function registerOriginPolicy(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    delegator: (request, callback) => {
      const origin = request.headers.origin;
      if (origin && isTrustedOrigin(origin, request.host)) {
        callback(null, { origin: true, credentials: true });
      } else {
        callback(null, { origin: corsAllowsAnyOrigin() ? '*' : false });
      }
    },
  });
  app.addHook('onRequest', async (request, reply) => {
    if (isCrossSiteCookieWrite(request)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'This request did not come from Tracearr.',
      });
    }
  });
}
