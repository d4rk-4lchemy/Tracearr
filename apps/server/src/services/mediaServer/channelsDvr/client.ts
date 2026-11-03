import { fetchJson } from '../../../utils/http.js';
import { channelsDvrArtworkPath, isChannelsDvrItemId } from './artwork.js';
import type {
  IMediaServerClient,
  MediaLibrary,
  MediaLibraryItem,
  MediaServerConfig,
  MediaSession,
  MediaUser,
} from '../types.js';
import { channelsDvrUserId, parseDvrActivity, parseWatchActivity, toMediaSession } from './parser.js';

/**
 * Channels DVR client (sessions only).
 *
 * Reads the undocumented `GET /dvr` status document and turns its "Watching"
 * activity lines into sessions. The Channels DVR server API has no
 * authentication on the local network, so `config.token` is unused.
 * See parser.ts for the caveats on the data format.
 */
interface ChannelsDvrClientInfo {
  id?: string;
  machine_id?: string;
  hostname?: string;
  alias?: string;
  device?: string;
  platform?: string;
  app_bundle?: string;
  app_build?: string;
  local_ip?: string;
  remote_ip?: string;
  connected?: boolean;
}

function normalizeClientIp(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

export class ChannelsDvrClient implements IMediaServerClient {
  private static readonly ARTWORK_CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly GUIDE_CACHE_TTL_MS = 60 * 1000;

  public readonly serverType = 'channels_dvr' as const;
  private readonly baseUrl: string;
  private readonly artworkCache = new Map<string, { path: string | null; expiresAt: number }>();
  private readonly fileDetailsCache = new Map<string, { data: Record<string, unknown> | null; expiresAt: number }>();
  private guideCache: { data: unknown; expiresAt: number } | null = null;
  private clientInfoCache: { data: ChannelsDvrClientInfo[]; expiresAt: number } | null = null;
  private guideRefresh: Promise<unknown> | null = null;
  private static readonly GUIDE_WAIT_TIMEOUT_MS = 1500;

  constructor(config: MediaServerConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
  }

  private async getDvrStatus(): Promise<unknown> {
    return fetchJson<unknown>(`${this.baseUrl}/dvr`, {
      headers: { Accept: 'application/json' },
      service: 'channels-dvr',
      timeout: 10000,
    });
  }

  /** Fetch the DVR's registered client records, cached to avoid polling on every session refresh. */
  private async getClientInfo(): Promise<ChannelsDvrClientInfo[]> {
    if (this.clientInfoCache && this.clientInfoCache.expiresAt > Date.now()) {
      return this.clientInfoCache.data;
    }

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/dvr/clients/info`, {
        headers: { Accept: 'application/json' },
        service: 'channels-dvr',
        timeout: 10000,
      });
      const clients = Array.isArray(data)
        ? data.filter((item): item is ChannelsDvrClientInfo =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
          )
        : [];
      this.clientInfoCache = { data: clients, expiresAt: Date.now() + 60_000 };
      return clients;
    } catch {
      // Device metadata is optional; never let this endpoint hide playback sessions.
      this.clientInfoCache = { data: [], expiresAt: Date.now() + 60_000 };
      return [];
    }
  }

  /**
   * Return cached guide data or share a single in-flight refresh.
   * Callers apply a short wait limit so guide artwork cannot stall sessions.
   */
  private getGuideData(): Promise<unknown> {
    if (this.guideCache && this.guideCache.expiresAt > Date.now()) {
      return Promise.resolve(this.guideCache.data);
    }

    if (!this.guideRefresh) {
      this.guideRefresh = fetchJson<unknown>(`${this.baseUrl}/devices/ANY/guide`, {
        headers: { Accept: 'application/json' },
        service: 'channels-dvr',
        timeout: 10000,
      })
        .then(
          (data) => {
            this.guideCache = {
              data,
              expiresAt: Date.now() + ChannelsDvrClient.GUIDE_CACHE_TTL_MS,
            };
            return data;
          },
          () => {
            // Guide artwork is optional. A guide failure must not hide live sessions.
            this.guideCache = {
              data: null,
              expiresAt: Date.now() + ChannelsDvrClient.GUIDE_CACHE_TTL_MS,
            };
            return null;
          }
        )
        .finally(() => {
          this.guideRefresh = null;
        });
    }

    // Serve stale data while a refresh is in flight, if available.
    return this.guideCache?.data != null
      ? Promise.resolve(this.guideCache.data)
      : this.guideRefresh;
  }

  /** Wait briefly for guide art, but never let it hold up live-session polling. */
  private async getGuideDataForSession(): Promise<unknown> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.getGuideData(),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), ChannelsDvrClient.GUIDE_WAIT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** Find the current programme title and image for a channel. */
  private getLiveAiring(
    guide: unknown,
    channelNumber: string
  ): { artworkPath: string | null; programTitle: string | null } | null {
    if (!Array.isArray(guide)) return null;

    const now = Date.now() / 1000;
    for (const entry of guide) {
      if (!entry || typeof entry !== 'object') continue;
      const channel = (entry as { Channel?: unknown }).Channel;
      const airings = (entry as { Airings?: unknown }).Airings;
      if (!channel || typeof channel !== 'object' || !Array.isArray(airings)) continue;

      const number = (channel as { Number?: unknown }).Number;
      if (String(number ?? '') !== channelNumber) continue;

      for (const airing of airings) {
        if (!airing || typeof airing !== 'object') continue;
        const item = airing as {
          Time?: unknown;
          Duration?: unknown;
          Image?: unknown;
          Title?: unknown;
          EpisodeTitle?: unknown;
        };
        if (
          typeof item.Time !== 'number' ||
          typeof item.Duration !== 'number' ||
          item.Time > now ||
          item.Time + item.Duration <= now
        ) {
          continue;
        }

        const programTitle =
          typeof item.EpisodeTitle === 'string' && item.EpisodeTitle.trim()
            ? item.EpisodeTitle.trim()
            : typeof item.Title === 'string' && item.Title.trim()
              ? item.Title.trim()
              : null;
        return {
          artworkPath: channelsDvrArtworkPath(this.baseUrl, item.Image),
          programTitle,
        };
      }
    }

    return null;
  }

  private async getLibraryItem(path: string): Promise<Record<string, unknown> | null> {
    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        service: 'channels-dvr',
        timeout: 10000,
      });
      return data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** Fetch DVR file metadata, which includes programme and episode details. */
  private async getRecordingFileDetails(fileId: string): Promise<Record<string, unknown> | null> {
    const cached = this.fileDetailsCache.get(fileId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const data = await this.getLibraryItem(`/dvr/files/${fileId}`);
    this.fileDetailsCache.set(fileId, {
      data,
      expiresAt: Date.now() + ChannelsDvrClient.ARTWORK_CACHE_TTL_MS,
    });
    return data;
  }

  /**
   * Resolve a recording's primary artwork using the documented Channels
   * library API. The activity feed only identifies the file, so metadata is
   * looked up by that ID and cached to avoid polling the API on every cycle.
   */
  private async getRecordingArtwork(
    parsed: NonNullable<ReturnType<typeof parseWatchActivity>>
  ): Promise<string | null> {
    if (parsed.kind !== 'recording' || !isChannelsDvrItemId(parsed.sourceId)) return null;

    const fileId = parsed.sourceId;
    const cacheKey = `${parsed.show ? 'episode' : 'movie'}:${fileId}`;
    const cached = this.artworkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.path;

    let artworkPath: string | null = null;

    if (parsed.show) {
      const episode = await this.getLibraryItem(`/api/v1/episodes/${fileId}`);
      const showId = typeof episode?.show_id === 'string' ? episode.show_id : undefined;

      // Prefer the parent show's poster over an episode still/frame. The
      // episode image is retained as a fallback when show art is unavailable.
      if (isChannelsDvrItemId(showId)) {
        const show = await this.getLibraryItem(`/api/v1/shows/${showId}`);
        artworkPath = channelsDvrArtworkPath(this.baseUrl, show?.image_url);
      }
      artworkPath ??= channelsDvrArtworkPath(this.baseUrl, episode?.image_url);
    } else {
      // Movies includes feature films, including locally imported movies.
      // Videos is the fallback for imported items that Channels classifies
      // separately from its movie library.
      const movie = await this.getLibraryItem(`/api/v1/movies/${fileId}`);
      artworkPath = channelsDvrArtworkPath(this.baseUrl, movie?.image_url);
      if (!artworkPath) {
        const video = await this.getLibraryItem(`/api/v1/videos/${fileId}`);
        artworkPath = channelsDvrArtworkPath(this.baseUrl, video?.image_url);
      }
    }

    // Cache misses too, so a missing artwork record does not cause repeated
    // metadata requests during every session poll. The session parser keeps
    // its /dvr/files/<id>/preview.jpg fallback in that case.
    this.artworkCache.set(cacheKey, {
      path: artworkPath,
      expiresAt: Date.now() + ChannelsDvrClient.ARTWORK_CACHE_TTL_MS,
    });
    if (this.artworkCache.size > 500) {
      for (const [key, value] of this.artworkCache) {
        if (value.expiresAt <= Date.now()) this.artworkCache.delete(key);
      }
    }

    return artworkPath;
  }

  async getSessions(sessionKey?: string): Promise<MediaSession[]> {
    const data = await this.getDvrStatus();
    const parsedSessions = [];
    for (const entry of parseDvrActivity(data)) {
      if (sessionKey && entry.key !== sessionKey) continue;
      const parsed = parseWatchActivity(entry);
      if (parsed) parsedSessions.push(parsed);
    }

    const clients = parsedSessions.length > 0 ? await this.getClientInfo() : [];

    // One guide request serves every live session in this poll. The short
    // cache avoids re-downloading the full guide on every frequent poll.
    const hasLiveChannel = parsedSessions.some(
      (parsed) => parsed.kind === 'live' && Boolean(parsed.sourceId)
    );
    const guide = hasLiveChannel ? await this.getGuideDataForSession() : null;

    return Promise.all(
      parsedSessions.map(async (parsed) => {
        const session = toMediaSession(parsed);
        const sessionIp = normalizeClientIp(parsed.ipAddress);
        const matchingClient = sessionIp
          ? clients
              .filter((client) =>
                normalizeClientIp(client.local_ip) === sessionIp ||
                normalizeClientIp(client.remote_ip) === sessionIp
              )
              .sort((a, b) => {
                const connected = Number(Boolean(b.connected)) - Number(Boolean(a.connected));
                if (connected !== 0) return connected;
                return Number(normalizeClientIp(b.local_ip) === sessionIp) -
                  Number(normalizeClientIp(a.local_ip) === sessionIp);
              })[0]
          : undefined;
        const clientProduct = matchingClient
          ? `${matchingClient.app_bundle?.endsWith('.beta') ? 'Channels Beta' : 'Channels'}${matchingClient.app_build ? ` v${matchingClient.app_build}` : ''}`
          : undefined;
        const sessionWithClient = matchingClient
          ? {
              ...session,
              player: {
                ...session.player,
                name: matchingClient.hostname || matchingClient.alias || session.player.name,
                deviceId: matchingClient.machine_id || matchingClient.id || session.player.deviceId,
                ...(matchingClient.device ? { device: matchingClient.device } : {}),
                ...(matchingClient.platform ? { platform: matchingClient.platform } : {}),
                ...(clientProduct ? { product: clientProduct } : {}),
              },
            }
          : session;
        const fileDetails =
          parsed.kind === 'recording' && isChannelsDvrItemId(parsed.sourceId)
            ? await this.getRecordingFileDetails(parsed.sourceId)
            : null;
        const airing = fileDetails?.Airing && typeof fileDetails.Airing === 'object'
          ? (fileDetails.Airing as Record<string, unknown>)
          : null;
        const fileShowTitle =
          (typeof airing?.Title === 'string' ? airing.Title.trim() : '') || parsed.show?.title || '';
        const episodeTitle =
          (typeof airing?.EpisodeTitle === 'string' ? airing.EpisodeTitle.trim() : '') ||
          parsed.show?.episodeTitle || '';
        const seasonNumber =
          typeof airing?.SeasonNumber === 'number' ? airing.SeasonNumber : parsed.show?.season;
        const episodeNumber =
          typeof airing?.EpisodeNumber === 'number' ? airing.EpisodeNumber : parsed.show?.episode;
        const fileDuration = typeof fileDetails?.Duration === 'number' ? fileDetails.Duration : null;
        const fileArtwork = channelsDvrArtworkPath(this.baseUrl, airing?.Image);
        const liveAiring =
          parsed.kind === 'live' && parsed.sourceId
            ? this.getLiveAiring(guide, parsed.sourceId)
            : null;
        const artworkPath =
          liveAiring?.artworkPath ??
          fileArtwork ??
          (parsed.kind === 'recording' ? await this.getRecordingArtwork(parsed) : null);
        const hasFileEpisode =
          Boolean(fileShowTitle && episodeTitle) &&
          seasonNumber !== undefined &&
          episodeNumber !== undefined;
        if (!liveAiring?.programTitle && !artworkPath && !hasFileEpisode && fileDuration === null) {
          return sessionWithClient;
        }
        return {
          ...sessionWithClient,
          ...(hasFileEpisode && seasonNumber !== undefined && episodeNumber !== undefined
            ? { episode: { showTitle: fileShowTitle, seasonNumber, episodeNumber } }
            : {}),
          media: {
            ...session.media,
            ...(liveAiring?.programTitle ? { title: liveAiring.programTitle } : {}),
            ...(hasFileEpisode
              ? {
                  title: episodeTitle,
                }
              : {}),
            ...(fileDuration !== null ? { durationMs: Math.round(fileDuration * 1000) } : {}),
            ...(artworkPath ? { thumbPath: artworkPath } : {}),
          },
        };
      })
    );
  }

  /**
   * Channels DVR has no user list. Devices currently watching are returned so
   * user sync has something to work with; the poller also creates users from
   * sessions as they appear.
   */
  async getUsers(): Promise<MediaUser[]> {
    const data = await this.getDvrStatus();
    const byId = new Map<string, MediaUser>();
    for (const entry of parseDvrActivity(data)) {
      const parsed = parseWatchActivity(entry);
      if (!parsed) continue;
      const id = channelsDvrUserId(parsed);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          username: parsed.clientName ?? parsed.ipAddress ?? 'Unknown device',
          isAdmin: false,
        });
      }
    }
    return [...byId.values()];
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    return [];
  }

  async testConnection(): Promise<boolean> {
    try {
      const data = await this.getDvrStatus();
      return !!data && typeof data === 'object' && !Array.isArray(data) && 'activity' in data;
    } catch {
      return false;
    }
  }

  async getSoftwareVersion(): Promise<string | null> {
    try {
      const data = await this.getDvrStatus();
      const version = (data as { version?: unknown } | null)?.version;
      return typeof version === 'string' && version ? version : null;
    } catch {
      return null;
    }
  }

  terminateSession(): Promise<boolean> {
    return Promise.reject(new Error('Channels DVR does not support terminating sessions'));
  }

  getLibraryItems(): Promise<{ items: MediaLibraryItem[]; totalCount: number }> {
    return Promise.resolve({ items: [], totalCount: 0 });
  }
}
