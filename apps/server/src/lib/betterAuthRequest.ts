import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth, CLIENT_IP_HEADER } from './auth.js';

/**
 * Adapts a Fastify request into a fetch Request for the Better Auth handler.
 *
 * Better Auth has no baseURL configured, so it derives its per-request
 * trusted origin from this URL. Behind a TLS-terminating reverse proxy the
 * scheme must reflect the client-facing protocol (x-forwarded-proto) or the
 * derived origin is http://host while the browser sends Origin: https://host,
 * and every cookie-bearing request fails with 403 INVALID_ORIGIN. Trusting
 * x-forwarded-proto for the scheme is safe against the browser CSRF threat
 * model: a cross-site page cannot attach that header, and a direct request
 * that forges it still has to present an Origin matching the derived
 * https://host origin, which a cross-site page cannot send.
 */
export function toWebRequest(request: FastifyRequest): Request {
  const forwarded = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const scheme = proto === 'https' || proto === 'http' ? proto : request.protocol;
  const url = new URL(request.url, `${scheme}://${request.headers.host}`);
  const headers = fromNodeHeaders(request.headers);
  // Better Auth trusts this header unconditionally for rate limiting and
  // session.ipAddress, so it must be set (never appended) after the inbound
  // headers are copied: an attacker-supplied copy cannot survive. Should
  // request.ip ever be unavailable, dropping the header leaves Better Auth
  // on its no-ip default (shared bucket), no worse than an unset header.
  if (request.ip) {
    headers.set(CLIENT_IP_HEADER, request.ip);
  } else {
    headers.delete(CLIENT_IP_HEADER);
  }
  return new Request(url.toString(), {
    method: request.method,
    headers,
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
}

type BetterAuthHandlerSource = () => { handler: (request: Request) => Promise<Response> };

/**
 * Fastify handler for the Better Auth wildcard mount (GET/POST
 * /api/v1/auth/*). index.ts registers it against the getAuth() singleton;
 * test harnesses register this same function (optionally against a
 * purpose-built auth instance) so they exercise this exact code path rather
 * than a copy.
 */
export function createBetterAuthHandler(source: BetterAuthHandlerSource = getAuth) {
  return async function betterAuthHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    try {
      const response = await source().handler(toWebRequest(request));
      reply.status(response.status);
      for (const [key, value] of response.headers) {
        reply.header(key, value);
      }
      return await reply.send(response.body ? await response.text() : null);
    } catch (error) {
      request.log.error({ err: error }, 'better auth handler error');
      return reply.status(500).send({ error: 'Internal authentication error' });
    }
  };
}
