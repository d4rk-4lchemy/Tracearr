import { fetchJson } from '../../../utils/http.js';
import type {
  IMediaServerClient,
  MediaLibrary,
  MediaLibraryItem,
  MediaServerConfig,
  MediaSession,
  MediaUser,
} from '../types.js';
import {
  normalizeDispatcharrChannel,
  parseChannelClients,
  parseSessionsFromChannels,
  parseStatusResponse,
  parseUsersResponse,
  type DispatcharrChannelStatus,
} from './parser.js';

function isJwtLike(token: string): boolean {
  return token.split('.').length === 3;
}

export class DispatcharrClient implements IMediaServerClient {
  public readonly serverType = 'dispatcharr' as const;

  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: MediaServerConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.token = config.token.trim();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!this.token) return headers;

    if (this.token.toLowerCase().startsWith('bearer ')) {
      headers.Authorization = this.token;
    } else if (isJwtLike(this.token)) {
      headers.Authorization = `Bearer ${this.token}`;
    } else {
      headers['X-API-Key'] = this.token;
    }

    return headers;
  }

  async getSessions(): Promise<MediaSession[]> {
    const [users, status] = await Promise.all([this.getUsers(), this.getStatus()]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const channelById = new Map(
      status
        .map((channel) => {
          const channelId = String(channel.channel_id ?? '').trim();
          return channelId ? [channelId, channel] : null;
        })
        .filter((entry): entry is [string, DispatcharrChannelStatus] => entry !== null)
    );

    const detailResults = await Promise.allSettled(
      status
        .filter(
          (channel) =>
            Number(channel.client_count ?? 0) > 0 || parseChannelClients(channel).length > 0
        )
        .map((channel) => this.getChannelStatus(String(channel.channel_id)))
    );

    const detailedChannels = detailResults.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    );

    const normalizedChannels = detailedChannels.flatMap((detailChannel) => {
      const channelId = String(detailChannel.channel_id ?? '').trim();
      if (!channelId) return [];
      const baseChannel = channelById.get(channelId) ?? detailChannel;
      const normalized = normalizeDispatcharrChannel(baseChannel, detailChannel);
      return normalized ? [normalized] : [];
    });

    const logoPathByChannelId = await this.getLogoPathByChannelId(
      normalizedChannels.map((channel) => channel.channelId)
    );
    const currentProgramByChannelId = await this.getCurrentProgramByChannelId(
      normalizedChannels.map((channel) => channel.channelId)
    );

    for (const channel of normalizedChannels) {
      channel.currentProgramTitle = currentProgramByChannelId.get(channel.channelId);
    }

    return parseSessionsFromChannels(normalizedChannels, userById, logoPathByChannelId);
  }

  async getUsers(): Promise<MediaUser[]> {
    const users: MediaUser[] = [];
    let nextUrl: string | null = `${this.baseUrl}/api/accounts/users/`;

    while (nextUrl) {
      const requestUrl = nextUrl;
      const data: unknown = await fetchJson<unknown>(requestUrl, {
        headers: this.buildHeaders(),
        service: 'dispatcharr',
        timeout: 10000,
      });
      users.push(...parseUsersResponse(data));

      const record: { next?: unknown } | null =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as { next?: unknown })
          : null;
      nextUrl = typeof record?.next === 'string' && record.next ? record.next : null;
    }

    return users;
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    return [];
  }

  async testConnection(): Promise<boolean> {
    try {
      await Promise.all([this.getUsers(), this.getStatus()]);
      return true;
    } catch {
      return false;
    }
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    const separator = sessionId.indexOf(':');
    if (separator <= 0 || separator === sessionId.length - 1) {
      throw new Error('Dispatcharr session id must be in channel_id:client_id format');
    }

    const channelId = sessionId.slice(0, separator);
    const clientId = sessionId.slice(separator + 1);
    const response = await fetch(
      `${this.baseUrl}/proxy/ts/stop_client/${encodeURIComponent(channelId)}`,
      {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client_id: clientId }),
      }
    );

    if (!response.ok) {
      if (response.status === 404) throw new Error('Session not found (may have already ended)');
      if (response.status === 401 || response.status === 403) {
        throw new Error('Unauthorized to terminate Dispatcharr session');
      }
      throw new Error(
        `Failed to terminate Dispatcharr session: ${response.status} ${response.statusText}`
      );
    }

    return true;
  }

  async getLibraryItems(): Promise<{ items: MediaLibraryItem[]; totalCount: number }> {
    return { items: [], totalCount: 0 };
  }

  static async verifyServerAdmin(
    apiKey: string,
    serverUrl: string
  ): Promise<{ success: true } | { success: false; code: string; message: string }> {
    const client = new DispatcharrClient({ url: serverUrl, token: apiKey });
    const success = await client.testConnection();
    return success
      ? { success: true }
      : {
          success: false,
          code: 'CONNECTION_FAILED',
          message: 'Cannot connect to Dispatcharr or API key does not have access',
        };
  }

  private async getStatus(): Promise<DispatcharrChannelStatus[]> {
    const data = await fetchJson<unknown>(`${this.baseUrl}/proxy/ts/status`, {
      headers: this.buildHeaders(),
      service: 'dispatcharr',
      timeout: 10000,
    });
    return parseStatusResponse(data);
  }

  private async getChannelStatus(channelId: string): Promise<DispatcharrChannelStatus | null> {
    if (!channelId || channelId === 'undefined') return null;
    return fetchJson<DispatcharrChannelStatus>(
      `${this.baseUrl}/proxy/ts/status/${encodeURIComponent(channelId)}`,
      {
        headers: this.buildHeaders(),
        service: 'dispatcharr',
        timeout: 10000,
      }
    );
  }

  private async getLogoPathByChannelId(channelIds: string[]): Promise<Map<string, string>> {
    const uniqIds = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqIds.length === 0) return new Map();

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/api/channels/channels/by-uuids/`, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uuids: uniqIds }),
        service: 'dispatcharr',
        timeout: 10000,
      });

      const records = this.extractRecords(data);
      const logoPathByChannelId = new Map<string, string>();
      for (const record of records) {
        const channelId = this.getRecordString(record, ['uuid', 'channel_id', 'id']);
        const logoId = this.getRecordString(record, ['logo_id', 'logoId']);
        if (!channelId || !logoId) continue;
        logoPathByChannelId.set(
          channelId,
          `${this.baseUrl}/api/channels/logos/${encodeURIComponent(logoId)}/cache/`
        );
      }
      return logoPathByChannelId;
    } catch {
      return new Map();
    }
  }

  private async getCurrentProgramByChannelId(channelIds: string[]): Promise<Map<string, string>> {
    const uniqIds = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqIds.length === 0) return new Map();

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/api/epg/current-programs/`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ channel_uuids: uniqIds }),
        service: 'dispatcharr',
        timeout: 10000,
      });

      const records = this.extractRecords(data);
      const map = new Map<string, string>();
      for (const record of records) {
        const channelId = this.getRecordString(record, ['channel_id', 'channel_uuid', 'uuid']);
        const title = this.getRecordString(record, ['title', 'program_title', 'name']);
        if (!channelId || !title) continue;
        map.set(channelId, title);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private extractRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) return payload.filter(this.isRecord);
    if (!this.isRecord(payload)) return [];
    const candidates = [payload.results, payload.data, payload.channels, payload.programs];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(this.isRecord);
      }
    }
    return [payload];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private getRecordString(
    record: Record<string, unknown>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = record[key];
      const str =
        typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
      if (str) return str;
    }
    return undefined;
  }
}
