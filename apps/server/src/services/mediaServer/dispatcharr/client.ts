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

    return parseSessionsFromChannels(detailedChannels, userById);
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
}
