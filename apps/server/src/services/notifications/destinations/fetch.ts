import { UnrecoverableError } from 'bullmq';
import { assertSafeProbeUrl } from '../../../utils/ssrf.js';
import type { DeliverContext } from './types.js';

export const DELIVER_TIMEOUT_MS = 10_000;

/** Basic-auth embedded in the URL becomes an Authorization header. */
export function buildFetchOptions(rawUrl: string): {
  url: string;
  headers: Record<string, string>;
} {
  const parsed = new URL(rawUrl);
  const headers: Record<string, string> = {};
  if (parsed.username || parsed.password) {
    headers['Authorization'] =
      `Basic ${btoa(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`)}`;
    parsed.username = '';
    parsed.password = '';
  }
  return { url: parsed.toString(), headers };
}

/** SSRF policy first (link-local and non-web only; LAN/Tailscale/loopback allowed), then a timed request that throws on non-2xx. */
export async function deliverFetch(
  rawUrl: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  ctx: DeliverContext
): Promise<void> {
  try {
    assertSafeProbeUrl(rawUrl);
  } catch (error) {
    throw new UnrecoverableError(
      `${ctx.destination.name}: ${error instanceof Error ? error.message : 'blocked url'}`
    );
  }
  const { url, headers } = buildFetchOptions(rawUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: ctx.signal,
    });
  } catch (error) {
    const reason = connectFailure(error);
    throw new Error(`${ctx.destination.name}: could not reach ${new URL(url).host}: ${reason}`, {
      cause: error instanceof Error && error.cause instanceof Error ? error.cause : error,
    });
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).slice(0, 500);
    throw Object.assign(new Error(`${ctx.destination.name}: ${response.status} ${text}`.trim()), {
      status: response.status,
      body: text,
    });
  }
}

/**
 * fetch rejects with a bare "fetch failed"; the reason is on its cause. A dual-stack host
 * fails with an AggregateError whose own message is empty and whose errors hold one
 * "connect ETIMEDOUT 1.2.3.4:443" per address tried.
 */
function connectFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timed out';
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    return cause.errors
      .map((e: unknown) => (e instanceof Error ? e.message : String(e)))
      .join('; ');
  }
  return cause instanceof Error ? cause.message : String(cause);
}
