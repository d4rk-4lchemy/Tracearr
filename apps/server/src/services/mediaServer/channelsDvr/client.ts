import { fetchJson } from '../../../utils/http.js';
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
export class ChannelsDvrClient implements IMediaServerClient {
  public readonly serverType = 'channels_dvr' as const;
  private readonly baseUrl: string;

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

  async getSessions(sessionKey?: string): Promise<MediaSession[]> {
    const data = await this.getDvrStatus();
    const sessions: MediaSession[] = [];
    for (const entry of parseDvrActivity(data)) {
      if (sessionKey && entry.key !== sessionKey) continue;
      const parsed = parseWatchActivity(entry);
      if (parsed) sessions.push(toMediaSession(parsed));
    }
    return sessions;
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
