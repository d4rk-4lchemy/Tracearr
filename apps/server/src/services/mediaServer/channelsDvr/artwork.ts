/**
 * Convert artwork URLs returned by the Channels DVR library API into paths
 * that can safely be fetched through Tracearr's Channels DVR image proxy.
 *
 * Channels returns TMS poster URLs as well as local /dvr/uploads URLs. TMS
 * artwork is available through the server's /tmsimg proxy, so the image
 * pipeline never needs to fetch an arbitrary third-party URL.
 */
export function channelsDvrArtworkPath(baseUrl: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const value = raw.trim();
  // The image proxy deliberately rejects percent-encoded paths. Reject them
  // here as well so the stored path always satisfies that same contract.
  if (value.includes('%') || value.includes('\\') || value.includes('\0')) return null;

  let imageUrl: URL;
  let serverUrl: URL;
  try {
    serverUrl = new URL(baseUrl);
    imageUrl = new URL(value, serverUrl);
  } catch {
    return null;
  }

  if (imageUrl.username || imageUrl.password || imageUrl.hash) return null;

  // User-uploaded artwork is served directly by the configured Channels DVR
  // instance. Only the documented upload content route is accepted.
  if (
    imageUrl.origin === serverUrl.origin &&
    /^\/dvr\/uploads\/\d+\/content$/.test(imageUrl.pathname)
  ) {
    return `${imageUrl.pathname}${imageUrl.search}`;
  }

  // Channels' guide/library artwork is hosted by TMS. Route it back through
  // Channels DVR's own /tmsimg proxy rather than allowing arbitrary CDN hosts.
  if (
    imageUrl.protocol === 'https:' &&
    imageUrl.hostname === 'tmsimg.fancybits.co' &&
    imageUrl.port === '' &&
    /^\/assets\/[A-Za-z0-9._/-]+$/.test(imageUrl.pathname) &&
    /^[?&=A-Za-z0-9._-]*$/.test(imageUrl.search)
  ) {
    return `/tmsimg${imageUrl.pathname}${imageUrl.search}`;
  }

  return null;
}

/** Library item IDs in Channels DVR are numeric strings. */
export function isChannelsDvrItemId(value: string | undefined): value is string {
  return Boolean(value && /^\d+$/.test(value));
}
