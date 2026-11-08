/**
 * Channels DVR parser
 *
 * Channels DVR has no documented endpoint for "who is watching". The only
 * source is the undocumented `GET /dvr` response, whose `activity` object maps
 * an opaque key to a human-readable sentence, e.g.
 *
 *   "6-file-4880-10.0.0.90": "Watching recording Beat Bobby Flay S26E02 ... from 10.0.0.90."
 *   "6-stream-M3U-mlbradiofeeds-1429-10.100.12.98": "Watching ch1429 MLBTV.WSH from iPad."
 *
 * The same map also carries non-viewing work (recording, commercial detection,
 * guide updates), so entries are filtered to "Watching" lines only. Because the
 * format is not a stable contract, every extraction here is best-effort and the
 * parser never throws on unexpected input.
 *
 * Channels DVR has no user accounts, so the "user" is the client device (its
 * name when the server reports one, otherwise its IP address).
 */

import type { MediaSession } from '../types.js';
import { channelLogoPath } from './logos.js';

export interface DispatcharrArtworkSession {
  serverId: string;
  username?: string | null;
  ipAddress: string | null;
  channelTitle: string | null;
  channelThumb: string | null;
}

function normalizeArtworkIp(ip: string | null | undefined): string {
  return (ip ?? '')
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
}

function normalizeArtworkChannel(title: string | null | undefined): string {
  return (title ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Attach Dispatcharr channel artwork to matching Channels DVR live sessions.
 * Channels DVR reports the viewer's IP in its activity key. Dispatcharr
 * reports the Channels DVR server's IP as its client IP, so the configured
 * Channels DVR server URL is used for correlation instead.
 *
 * If multiple Dispatcharr viewers match the same channel, artwork is only
 * attached when they all resolve to the same server and logo path.
 */
export function attachDispatcharrChannelArtwork(
  channelsDvrSessions: MediaSession[],
  channelsDvrServerUrl: string,
  dispatcharrSessions: DispatcharrArtworkSession[]
): MediaSession[] {
  let channelsDvrServerIp: string;

  try {
    channelsDvrServerIp = normalizeArtworkIp(new URL(channelsDvrServerUrl).hostname);
  } catch {
    return channelsDvrSessions;
  }

  if (!channelsDvrServerIp) return channelsDvrSessions;

  const candidates = dispatcharrSessions.filter(
    (session) =>
      session.username?.trim().toLowerCase() !== 'anonymous' &&
      normalizeArtworkIp(session.ipAddress) === channelsDvrServerIp &&
      Boolean(session.channelTitle?.trim()) &&
      Boolean(session.channelThumb?.trim())
  );

  if (candidates.length === 0) return channelsDvrSessions;

  return channelsDvrSessions.map((session) => {
    if (session.media.type !== 'live' || !session.live?.channelTitle) return session;

    const title = normalizeArtworkChannel(session.live.channelTitle);
    if (!title) return session;

    const matches = candidates.filter(
      (candidate) => normalizeArtworkChannel(candidate.channelTitle) === title
    );
    if (matches.length === 0) return session;

    const artworkSources = new Map<string, DispatcharrArtworkSession>();
    for (const match of matches) {
      const path = match.channelThumb!.trim();
      artworkSources.set(`${match.serverId}\0${path}`, match);
    }

    // Multiple clients on the same channel are fine if the artwork source
    // agrees. Conflicting sources are ambiguous, so leave the session alone.
    if (artworkSources.size !== 1) return session;

    const [match] = artworkSources.values();
    if (!match) return session;

    const logoPath = match.channelThumb!.trim();
    let normalizedLogoPath: string;

    try {
      const logoUrl = new URL(logoPath);
      normalizedLogoPath =
        logoUrl.protocol === 'http:' || logoUrl.protocol === 'https:'
          ? `${logoUrl.pathname}${logoUrl.search}`
          : logoPath.startsWith('/')
            ? logoPath
            : `/${logoPath}`;
    } catch {
      normalizedLogoPath = logoPath.startsWith('/') ? logoPath : `/${logoPath}`;
    }

    return {
      ...session,
      live: {
        ...session.live,
        channelThumb: `dispatcharr://${match.serverId}${normalizedLogoPath}`,
      },
    };
  });
}

export interface ChannelsDvrActivityEntry {
  key: string;
  text: string;
}

export interface ParsedWatchActivity {
  key: string;
  kind: 'recording' | 'live';
  /** Title as written by the server (file name stripped of date/extension for recordings) */
  title: string;
  /** Client device name when present in the text, otherwise undefined */
  clientName?: string;
  ipAddress?: string;
  /** Channel number for live streams, file id for recordings */
  sourceId?: string;
  /** Live only: programme text after the channel name, when the line has one */
  programme?: string;
  /** Live only: playback mode reported in the activity suffix. */
  videoDecision?: 'copy' | 'transcode';
  show?: { title: string; season: number; episode: number; episodeTitle?: string };
}

const IPV4_AT_END = /(\d{1,3}(?:\.\d{1,3}){3})$/;
const IPV4_ANYWHERE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const WATCHING_PREFIX = /^\s*watching\b\s*/i;
const SXXEYY = /\bS(\d{1,3})E(\d{1,4})\b/i;
const STATS_TAIL = /:\s*buf=.*$/i;
const FILE_DATE_SUFFIX = /\s+\d{4}-\d{2}-\d{2}-\d{4}(?:\.\w{2,4})?$/;
const FILE_EXTENSION = /\.(?:mpg|mpeg|ts|mp4|mkv|m4v|avi)$/i;

/** Pull the activity object out of a `/dvr` response. */
export function parseDvrActivity(data: unknown): ChannelsDvrActivityEntry[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const activity = (data as { activity?: unknown }).activity;
  if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return [];

  const entries: ChannelsDvrActivityEntry[] = [];
  for (const [key, value] of Object.entries(activity as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (key && text) entries.push({ key, text });
  }
  return entries;
}

/** Key shape: `<n>-file-<fileId>-<ip>` or `<n>-stream-<source...>-<channel>-<ip>`. */
function parseKey(key: string): {
  kind: 'recording' | 'live' | null;
  sourceId?: string;
  ipAddress?: string;
} {
  // Cellular HLS activity keys carry an opaque session ID, not an IP.
  const hlsSession = key.match(/^\d+-ch(\d+)-dANY-.+$/i);
  if (hlsSession) return { kind: 'live', sourceId: hlsSession[1] };

  const ipMatch = IPV4_AT_END.exec(key);
  const ipAddress = ipMatch?.[1];
  const withoutIp = ipMatch ? key.slice(0, ipMatch.index).replace(/-$/, '') : key;
  const parts = withoutIp.split('-');

  if (parts.length >= 3 && parts[1] === 'file') {
    return { kind: 'recording', sourceId: parts.slice(2).join('-') || undefined, ipAddress };
  }
  if (parts.length >= 3 && parts[1] === 'stream') {
    // Channel is the last segment once the IP is removed.
    return { kind: 'live', sourceId: parts[parts.length - 1] || undefined, ipAddress };
  }
  return { kind: null, ipAddress };
}

function cleanRecordingTitle(raw: string): string {
  return raw.replace(FILE_EXTENSION, '').replace(FILE_DATE_SUFFIX, '').trim();
}

/**
 * Parse one activity entry. Returns null for anything that is not a viewer
 * (recording jobs, processing, guide refresh, unknown text).
 */
export function parseWatchActivity(entry: ChannelsDvrActivityEntry): ParsedWatchActivity | null {
  if (!WATCHING_PREFIX.test(entry.text)) return null;

  const keyInfo = parseKey(entry.key);
  let body = entry.text.replace(WATCHING_PREFIX, '');

  // "Watching recording X ..." is a library playback; anything else is live TV.
  let kind: 'recording' | 'live' = keyInfo.kind ?? 'live';
  if (/^recording\b/i.test(body)) {
    kind = 'recording';
    body = body.replace(/^recording\b\s*/i, '');
  } else if (keyInfo.kind === null) {
    kind = 'live';
  }

  let clientName: string | undefined;
  let ipAddress = keyInfo.ipAddress;

  // Live lines end with player stats: ": buf=0% drop=0% timeouts=0 ..."
  body = body.replace(STATS_TAIL, '').trim();

  // The client is whatever follows the LAST " from " (or " on "), so titles that
  // contain those words are not cut short.
  const sepIdx = Math.max(
    body.toLowerCase().lastIndexOf(' from '),
    body.toLowerCase().lastIndexOf(' on ')
  );
  if (sepIdx >= 0) {
    let who = body
      .slice(sepIdx)
      .replace(/^\s+(?:from|on)\s+/i, '')
      .replace(/\.$/, '')
      .trim();
    const playbackMode = who.match(/\((Remux|Transcoder)\b[^)]*\)\s*$/i);
    const videoDecision = playbackMode
      ? playbackMode[1]!.toLowerCase() === 'remux' ? 'copy' as const : 'transcode' as const
      : undefined;
    // The elapsed time and speed in this suffix change on every poll. Strip
    // both playback modes before using the client name as a stable identity.
    who = who.replace(/\s*\((?:Remux|Transcoder)\b[^)]*\)\s*$/i, '').trim();
    body = body.slice(0, sepIdx).trim();
    const ipInWho = IPV4_ANYWHERE.exec(who);
    if (ipInWho && who === ipInWho[1]) {
      ipAddress = ipAddress ?? ipInWho[1];
    } else if (who) {
      clientName = who;
    }
  }

  // Live text often leads with the channel number ("ch1429 MLBTV.WSH").
  let title = kind === 'recording' ? cleanRecordingTitle(body) : body.trim();
  let programme: string | undefined;
  if (kind === 'live') {
    title = title.replace(/^ch(?:annel)?\s*[\w.]+\s+/i, '').trim() || title;
    // "NFL Game Pass 11: Chiefs vs Broncos @ ..." -> channel + programme
    const colon = title.indexOf(': ');
    if (colon > 0) {
      programme = title.slice(colon + 2).trim() || undefined;
      title = title.slice(0, colon).trim();
    }
  }
  if (!title) return null;

  const sxxeyyMatch = kind === 'recording' ? SXXEYY.exec(title) : null;
  const seasonEpisodeMatch =
    kind === 'recording' ? /\s+-\s+Season\s+(\d{1,3}),\s*Episode\s+(\d{1,4})\s*$/i.exec(title) : null;
  const show = sxxeyyMatch
    ? {
        title: title.slice(0, sxxeyyMatch.index).trim() || title,
        season: Number.parseInt(sxxeyyMatch[1]!, 10),
        episode: Number.parseInt(sxxeyyMatch[2]!, 10),
        episodeTitle: title.slice(sxxeyyMatch.index + sxxeyyMatch[0].length).trim() || undefined,
      }
    : seasonEpisodeMatch
      ? {
          title: title.slice(0, seasonEpisodeMatch.index).trim() || title,
          season: Number.parseInt(seasonEpisodeMatch[1]!, 10),
          episode: Number.parseInt(seasonEpisodeMatch[2]!, 10),
        }
      : undefined;

  return {
    key: entry.key,
    kind,
    title,
    clientName,
    ipAddress,
    sourceId: keyInfo.sourceId,
    programme,
    videoDecision,
    show,
  };
}

function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map((n) => Number.parseInt(n, 10)) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Stable per-device identity: the reported name, else the IP. */
export function channelsDvrUserId(parsed: ParsedWatchActivity): string {
  return (parsed.clientName ?? parsed.ipAddress ?? 'unknown').trim().toLowerCase();
}

export function toMediaSession(parsed: ParsedWatchActivity): MediaSession {
  const ip = parsed.ipAddress ?? '0.0.0.0';
  const displayName = parsed.clientName ?? parsed.ipAddress ?? 'Unknown device';
  const userId = channelsDvrUserId(parsed);
  const isLive = parsed.kind === 'live';
  const logoPath = isLive && parsed.sourceId ? channelLogoPath(parsed.sourceId) : null;
  // For recordings and imported videos the activity key carries the DVR file id,
  // and every file has a preview frame at /dvr/files/<id>/preview.jpg.
  const fileId =
    parsed.kind === 'recording' && parsed.sourceId && /^\d+$/.test(parsed.sourceId)
      ? parsed.sourceId
      : undefined;

  const base: MediaSession = {
    // Activity keys are unique per active stream and disappear when it stops.
    sessionKey: parsed.key,
    mediaId: parsed.sourceId ?? parsed.key,
    user: { id: userId, username: displayName },
    media: {
      title: parsed.programme ?? parsed.show?.episodeTitle ?? parsed.title,
      type: isLive ? 'live' : parsed.show ? 'episode' : 'movie',
      // Channels DVR does not report duration or position in the activity feed.
      durationMs: 0,
      ...(fileId ? { thumbPath: `/dvr/files/${fileId}/preview.jpg` } : {}),
      // Live channels without Dispatcharr artwork fall back to the guide logo.
      ...(isLive && logoPath ? { thumbPath: logoPath } : {}),
    },
    playback: { state: 'playing', positionMs: 0, progressPercent: 0 },
    player: {
      name: displayName,
      deviceId: userId,
      product: 'Channels',
      platform: 'Channels DVR',
    },
    network: { ipAddress: ip, isLocal: isPrivateIp(ip) },
    quality: {
      bitrate: 0,
      isTranscode: parsed.videoDecision === 'transcode',
      videoDecision: parsed.videoDecision ?? 'directplay',
      audioDecision: 'directplay',
    },
  };

  if (isLive) {
    base.live = {
      channelTitle: parsed.title,
      ...(parsed.sourceId ? { channelIdentifier: parsed.sourceId } : {}),
    };
  }
  if (parsed.show) {
    base.episode = {
      showTitle: parsed.show.title,
      seasonNumber: parsed.show.season,
      episodeNumber: parsed.show.episode,
    };
  }
  return base;
}

export function parseSessionsFromDvr(data: unknown): MediaSession[] {
  const sessions: MediaSession[] = [];
  for (const entry of parseDvrActivity(data)) {
    const parsed = parseWatchActivity(entry);
    if (parsed) sessions.push(toMediaSession(parsed));
  }
  return sessions;
}
