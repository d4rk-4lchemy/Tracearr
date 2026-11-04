import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetchJson } from '../../../utils/http.js';
import { SsrfBlockedError } from '../../../utils/ssrf.js';

/**
 * Live channel logos for Channels DVR.
 *
 * The activity feed has no artwork, but /dvr/guide/channels maps channel numbers
 * to an `Image` URL. Clients never supply that URL: they ask for
 * /dvr/guide/channels/<number>/logo and the server looks the URL up itself, so
 * the only URLs ever fetched are ones the configured Channels DVR server advertises.
 */

const CHANNEL_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LOGO_ROUTE = /^\/dvr\/guide\/channels\/([A-Za-z0-9][A-Za-z0-9._-]{0,31})\/logo$/;
const CACHE_TTL_MS = 10 * 60 * 1000;
const LOCAL_LOGO_PREFIXES = ['/tmsimg/', '/dvr/uploads/'];
const DISPATCHARR_LOGO_PATH = /^\/api\/channels\/logos\/\d+\/cache\/?$/;

const guideCache = new Map<string, { at: number; logos: Map<string, string> }>();

export function _resetChannelLogoCacheForTests(): void {
  guideCache.clear();
}

/** Artwork key for a live channel, or null if the channel number is not a safe token. */
export function channelLogoPath(channelNumber: string): string | null {
  return CHANNEL_NUMBER.test(channelNumber) ? `/dvr/guide/channels/${channelNumber}/logo` : null;
}

/** The channel number from an artwork key made by channelLogoPath, or null. */
export function parseChannelLogoPath(imagePath: string): string | null {
  return LOGO_ROUTE.exec(imagePath)?.[1] ?? null;
}

/** Channel number -> logo URL, from the /dvr/guide/channels response. */
export function parseGuideChannelLogos(data: unknown): Map<string, string> {
  const logos = new Map<string, string>();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return logos;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as { Image?: unknown; Number?: unknown };
    const image = typeof entry.Image === 'string' ? entry.Image.trim() : '';
    if (!image) continue;
    if (!logos.has(key)) logos.set(key, image);
    if (typeof entry.Number === 'string' && !logos.has(entry.Number)) {
      logos.set(entry.Number, image);
    }
  }
  return logos;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('::ffff:') ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower)
    );
  }
  return true;
}

/** Only https hostnames that resolve to public addresses; never IP literals. */
async function assertPublicHttpsUrl(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new SsrfBlockedError('External channel logos must be plain https URLs');
  }
  if (isIP(host) !== 0 || host === 'localhost' || !host.includes('.')) {
    throw new SsrfBlockedError('External channel logos must use a public hostname');
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new SsrfBlockedError('External channel logo host resolves to a non-public address');
  }
}

/**
 * Turn a guide `Image` value into a fetchable URL. Paths on the Channels DVR
 * server itself are origin-pinned; anything else must pass the public-host checks.
 */
export async function resolveLogoUrl(
  baseUrl: string,
  raw: string,
  trustedDispatcharrOrigins: readonly string[] = []
): Promise<string> {
  const base = new URL(baseUrl);
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    if (!LOCAL_LOGO_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
      throw new SsrfBlockedError('Unsupported local channel logo path');
    }
    const local = new URL(raw, base);
    if (local.origin !== base.origin) throw new SsrfBlockedError('Channel logo left the server');
    return local.href;
  }
  const target = new URL(raw);
  if (target.origin === base.origin) {
    if (!LOCAL_LOGO_PREFIXES.some((prefix) => target.pathname.startsWith(prefix))) {
      throw new SsrfBlockedError('Unsupported local channel logo path');
    }
    return target.href;
  }
  if (trustedDispatcharrOrigins.includes(target.origin)) {
    if (target.username || target.password || target.search || target.hash || !DISPATCHARR_LOGO_PATH.test(target.pathname)) {
      throw new SsrfBlockedError('Unsupported configured Dispatcharr channel logo URL');
    }
    return target.href;
  }
  await assertPublicHttpsUrl(target);
  return target.href;
}

export async function getChannelLogoUrl(
  baseUrl: string,
  channelNumber: string,
  trustedDispatcharrOrigins: readonly string[] = []
): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, '');
  let entry = guideCache.get(base);
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
    const data = await fetchJson<unknown>(`${base}/dvr/guide/channels`, {
      service: 'channels-dvr',
      timeout: 15_000,
      headers: { Accept: 'application/json' },
    });
    entry = { at: Date.now(), logos: parseGuideChannelLogos(data) };
    guideCache.set(base, entry);
  }
  const raw = entry.logos.get(channelNumber);
  return raw ? resolveLogoUrl(base, raw, trustedDispatcharrOrigins) : null;
}
