import { fetchJson } from '../../../utils/http.js';
import { parseOptionalBoundedString, parseOptionalString } from '../../../utils/parsing.js';

const POSITIVE_REFRESH_MARGIN_MS = 2_000;
const NEGATIVE_TTL_MS = 30_000;
const MAX_PROGRAMME_TITLE_LENGTH = 255;

interface EpgProgramme {
  title: string;
  startAt: number;
  endAt: number;
}

interface CacheEntry {
  programme: EpgProgramme | null;
  expiresAt: number;
  generation: number;
}

const entries = new Map<string, CacheEntry>();
const timers = new Map<string, NodeJS.Timeout>();
let pollTrigger: ((serverId: string) => void) | undefined;

export function registerLiveTvEpgPollTrigger(handler: (serverId: string) => void): void {
  pollTrigger = handler;
}

export function clearLiveTvEpgServer(serverId: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(`${serverId}:`)) {
      entries.delete(key);
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
    }
  }
}

function programmeFromRaw(value: unknown): EpgProgramme | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = parseOptionalBoundedString(raw.Name, MAX_PROGRAMME_TITLE_LENGTH);
  const startAt = Date.parse(parseOptionalString(raw.StartDate) ?? '');
  const endAt = Date.parse(parseOptionalString(raw.EndDate) ?? '');
  if (!title || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return null;
  }
  return { title, startAt, endAt };
}

function channelIdFromSession(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const session = value as Record<string, unknown>;
  const item = session.NowPlayingItem;
  if (!item || typeof item !== 'object') return null;
  const nowPlaying = item as Record<string, unknown>;
  const type = parseOptionalString(nowPlaying.Type)?.toLowerCase();
  if (type !== 'livetvchannel' && type !== 'tvchannel') return null;
  return parseOptionalString(nowPlaying.ChannelId) ?? parseOptionalString(nowPlaying.Id) ?? null;
}

function scheduleBoundary(serverId: string, channelId: string, entry: CacheEntry): void {
  const key = `${serverId}:${channelId}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const delay = Math.max(1_000, entry.expiresAt - Date.now() + POSITIVE_REFRESH_MARGIN_MS);
  const generation = entry.generation;
  const timer = setTimeout(() => {
    timers.delete(key);
    const current = entries.get(key);
    if (current?.generation !== generation) return;
    pollTrigger?.(serverId);
  }, delay);
  timer.unref?.();
  timers.set(key, timer);
}

function setEntry(serverId: string, channelId: string, programme: EpgProgramme | null, now: number) {
  const key = `${serverId}:${channelId}`;
  const previous = entries.get(key);
  const entry: CacheEntry = {
    programme,
    expiresAt: programme ? programme.endAt : now + NEGATIVE_TTL_MS,
    generation: (previous?.generation ?? 0) + 1,
  };
  entries.set(key, entry);
  if (programme) scheduleBoundary(serverId, channelId, entry);
}

export async function enrichLiveTvSessions(
  serverId: string,
  baseUrl: string,
  headers: Record<string, string>,
  sessions: unknown[],
  service: 'jellyfin' | 'emby',
  now = Date.now()
): Promise<unknown[]> {
  const channelIds = [...new Set(sessions.map(channelIdFromSession).filter(Boolean))] as string[];
  const missing = channelIds.filter((channelId) => {
    const entry = entries.get(`${serverId}:${channelId}`);
    return !entry || entry.expiresAt <= now;
  });

  if (missing.length > 0) {
    try {
      const params = new URLSearchParams({ channelIds: missing.join(','), isAiring: 'true' });
      const response = await fetchJson<{ Items?: unknown[] }>(
        `${baseUrl}/LiveTv/Programs?${params.toString()}`,
        { headers, service, timeout: 10_000 }
      );
      const programmesByChannel = new Map<string, EpgProgramme>();
      for (const item of Array.isArray(response?.Items) ? response.Items : []) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const channelId = parseOptionalString(raw.ChannelId);
        const programme = programmeFromRaw(item);
        if (!channelId || !programme || programme.startAt > now || programme.endAt <= now) continue;
        programmesByChannel.set(channelId, programme);
      }
      for (const channelId of missing) {
        setEntry(serverId, channelId, programmesByChannel.get(channelId) ?? null, now);
      }
    } catch (error) {
      for (const channelId of missing) setEntry(serverId, channelId, null, now);
      // EPG is optional; the session snapshot remains authoritative.
      console.warn(`[${service}] Live TV EPG unavailable for server ${serverId}`, error);
    }
  }

  return sessions.map((value) => {
    const channelId = channelIdFromSession(value);
    if (!channelId || !value || typeof value !== 'object') return value;
    const programme = entries.get(`${serverId}:${channelId}`)?.programme;
    if (!programme) return value;
    const session = value as Record<string, unknown>;
    const nowPlaying = session.NowPlayingItem;
    if (!nowPlaying || typeof nowPlaying !== 'object') return value;
    return {
      ...session,
      NowPlayingItem: { ...(nowPlaying as Record<string, unknown>), Name: programme.title },
    };
  });
}
