import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

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
  return new Request(url.toString(), {
    method: request.method,
    headers: fromNodeHeaders(request.headers),
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
}
