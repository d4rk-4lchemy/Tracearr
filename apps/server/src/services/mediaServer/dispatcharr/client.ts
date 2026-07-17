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
  type DispatcharrResolvedOutputProfile,
  normalizeDispatcharrChannel,
  parseSessionsFromVodStats,
  parseChannelClients,
  parseVodStatsResponse,
  parseSessionsFromChannels,
  parseStatusResponse,
  parseUsersResponse,
  type DispatcharrChannelStatus,
  type DispatcharrVodStatsResponse,
  type NormalizedDispatcharrChannel,
} from './parser.js';

export type DispatcharrTokenMode = 'jwt' | 'api-key' | 'credentials' | 'none';

interface DispatcharrCredentials {
  username: string;
  password: string;
}

interface DispatcharrCredentialAuthCache {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number;
}

const CREDENTIALS_TOKEN_PREFIX = 'dispatcharr-credentials:';
const TOKEN_REFRESH_SKEW_MS = 30_000;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const OUTPUT_PROFILE_CACHE_TTL_MS = 60_000;

interface DispatcharrOutputProfileApiRecord {
  id?: unknown;
  name?: unknown;
  command?: unknown;
  parameters?: unknown;
  is_active?: unknown;
}

function isJwtLike(token: string): boolean {
  return token.split('.').length === 3;
}

function detectTokenMode(token: string): DispatcharrTokenMode {
  const trimmed = token.trim();
  if (!trimmed) return 'none';
  if (trimmed.startsWith(CREDENTIALS_TOKEN_PREFIX)) return 'credentials';
  if (trimmed.toLowerCase().startsWith('bearer ') || isJwtLike(trimmed)) return 'jwt';
  return 'api-key';
}

function decodeJwtExpiration(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    const expSeconds =
      typeof payload.exp === 'number'
        ? payload.exp
        : typeof payload.exp === 'string'
          ? Number(payload.exp)
          : NaN;
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null;
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

export class DispatcharrClient implements IMediaServerClient {
  public readonly serverType = 'dispatcharr' as const;

  private static credentialCache = new Map<string, DispatcharrCredentialAuthCache>();
  private static outputProfileCache = new Map<
    string,
    { expiresAtMs: number; profilesById: Map<number, DispatcharrResolvedOutputProfile> }
  >();

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly credentials: DispatcharrCredentials | null;
  private readonly ignoreAnonymousStreams: boolean;

  constructor(config: MediaServerConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.token = config.token.trim();
    this.credentials = DispatcharrClient.decodeCredentialToken(this.token);
    this.ignoreAnonymousStreams = config.ignoreAnonymousStreams !== false;
  }

  static encodeCredentialToken(username: string, password: string): string {
    const payload = JSON.stringify({ username, password });
    return `${CREDENTIALS_TOKEN_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
  }

  static isCredentialToken(token: string): boolean {
    return token.trim().startsWith(CREDENTIALS_TOKEN_PREFIX);
  }

  private static decodeCredentialToken(token: string): DispatcharrCredentials | null {
    const trimmed = token.trim();
    if (!trimmed.startsWith(CREDENTIALS_TOKEN_PREFIX)) return null;
    const payload = trimmed.slice(CREDENTIALS_TOKEN_PREFIX.length);
    if (!payload) return null;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        username?: unknown;
        password?: unknown;
      };
      const username = typeof decoded.username === 'string' ? decoded.username.trim() : '';
      const password = typeof decoded.password === 'string' ? decoded.password : '';
      if (!username || !password) return null;
      return { username, password };
    } catch {
      return null;
    }
  }

  getTokenMode(): DispatcharrTokenMode {
    return detectTokenMode(this.token);
  }

  async getWebSocketToken(): Promise<string | null> {
    switch (this.getTokenMode()) {
      case 'jwt':
        return this.token.toLowerCase().startsWith('bearer ')
          ? this.token.slice(7).trim() || null
          : this.token;
      case 'credentials':
        return this.getCredentialAccessToken();
      default:
        return null;
    }
  }

  async getSessions(): Promise<MediaSession[]> {
    const [statusResult, vodStatsResult, userByIdResult] = await Promise.allSettled([
      this.getStatusSnapshot(),
      this.getVodStatsSnapshot(),
      this.getUserMap(),
    ]);

    if (statusResult.status === 'rejected') {
      throw statusResult.reason;
    }
    if (userByIdResult.status === 'rejected') {
      throw userByIdResult.reason;
    }

    const liveSessionsPromise = this.buildSessionsFromStatusSnapshot(
      statusResult.value,
      userByIdResult.value
    );
    const vodSessionsPromise =
      vodStatsResult.status === 'fulfilled'
        ? this.buildSessionsFromVodStatsSnapshot(vodStatsResult.value, userByIdResult.value).catch(
            (error: unknown) => {
              this.warnVodStatsFailure(error);
              return [];
            }
          )
        : Promise.resolve(this.warnAndSkipVodSessions(vodStatsResult.reason));

    const [liveSessions, vodSessions] = await Promise.all([liveSessionsPromise, vodSessionsPromise]);
    return [...liveSessions, ...vodSessions];
  }

  private warnAndSkipVodSessions(error: unknown): MediaSession[] {
    this.warnVodStatsFailure(error);
    return [];
  }

  private warnVodStatsFailure(error: unknown): void {
    console.warn(
      `Failed to fetch Dispatcharr VOD stats from ${this.baseUrl}; continuing with live sessions only`,
      error
    );
  }

  async buildSessionsFromStatusSnapshot(
    status: DispatcharrChannelStatus[],
    userById?: Map<string, MediaUser>
  ): Promise<MediaSession[]> {
    const normalizedChannels = await this.buildNormalizedChannelsFromStatus(status);
    const outputProfilesById = await this.getResolvedOutputProfilesForChannels(normalizedChannels);
    const resolvedUserMap = userById ?? (await this.getUserMap());
    const [logoPathByChannelId, currentProgramByChannelId] = await Promise.all([
      this.getLogoPathByChannelId(normalizedChannels.map((channel) => channel.channelId)),
      this.getCurrentProgramByChannelId(normalizedChannels.map((channel) => channel.channelId)),
    ]);

    for (const channel of normalizedChannels) {
      channel.currentProgramTitle = currentProgramByChannelId.get(channel.channelId);
    }

    return this.buildSessionsFromNormalizedChannels(
      normalizedChannels,
      resolvedUserMap,
      logoPathByChannelId,
      outputProfilesById
    );
  }

  async buildNormalizedChannelsFromStatus(
    status: DispatcharrChannelStatus[],
    detailChannels?: DispatcharrChannelStatus[]
  ): Promise<NormalizedDispatcharrChannel[]> {
    const channelById = new Map(
      status
        .map((channel) => {
          const channelId = String(channel.channel_id ?? '').trim();
          return channelId ? [channelId, channel] : null;
        })
        .filter((entry): entry is [string, DispatcharrChannelStatus] => entry !== null)
    );

    const details =
      detailChannels ??
      (await this.getActiveChannelDetails(
        status.filter(
          (channel) =>
            Number(channel.client_count ?? 0) > 0 || parseChannelClients(channel).length > 0
        )
      ));

    return details.flatMap((detailChannel) => {
      const channelId = String(detailChannel.channel_id ?? '').trim();
      if (!channelId) return [];
      const baseChannel = channelById.get(channelId) ?? detailChannel;
      const normalized = normalizeDispatcharrChannel(baseChannel, detailChannel);
      return normalized ? [normalized] : [];
    });
  }

  buildSessionsFromNormalizedChannels(
    channels: NormalizedDispatcharrChannel[],
    userById: Map<string, MediaUser>,
    logoPathByChannelId?: Map<string, string>,
    outputProfilesById?: Map<number, DispatcharrResolvedOutputProfile>
  ): MediaSession[] {
    return parseSessionsFromChannels(channels, userById, logoPathByChannelId, {
      ignoreAnonymousStreams: this.ignoreAnonymousStreams,
      outputProfilesById,
    });
  }

  async getUsers(): Promise<MediaUser[]> {
    const users: MediaUser[] = [];
    let nextUrl: string | null = `${this.baseUrl}/api/accounts/users/`;

    while (nextUrl) {
      const requestUrl = nextUrl;
      const data: unknown = await fetchJson<unknown>(requestUrl, {
        headers: await this.buildHeaders(),
        service: 'dispatcharr',
        timeout: 10000,
      });
      users.push(
        ...parseUsersResponse(data, {
          ignoreAnonymousStreams: this.ignoreAnonymousStreams,
        })
      );

      const record: { next?: unknown } | null =
        data && typeof data === 'object' && !Array.isArray(data)
          ? data
          : null;
      nextUrl = typeof record?.next === 'string' && record.next ? record.next : null;
    }

    return users;
  }

  async getUserMap(): Promise<Map<string, MediaUser>> {
    const users = await this.getUsers();
    return new Map(users.map((user) => [user.id, user]));
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    return [];
  }

  async testConnection(): Promise<boolean> {
    try {
      await Promise.all([this.getUsers(), this.getStatusSnapshot()]);
      return true;
    } catch {
      return false;
    }
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    const separator = sessionId.indexOf(':');
    if (separator > 0 && separator < sessionId.length - 1) {
      const channelId = sessionId.slice(0, separator);
      const clientId = sessionId.slice(separator + 1);
      const response = await fetch(
        `${this.baseUrl}/proxy/ts/stop_client/${encodeURIComponent(channelId)}`,
        {
          method: 'POST',
          headers: {
            ...(await this.buildHeaders()),
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

    const clientId = sessionId.trim();
    if (!clientId) throw new Error('Dispatcharr session id must not be empty');
    const response = await fetch(`${this.baseUrl}/proxy/vod/stop_client/`, {
      method: 'POST',
      headers: {
        ...(await this.buildHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ client_id: clientId }),
    });

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
    token: string,
    serverUrl: string
  ): Promise<{ success: true } | { success: false; code: string; message: string }> {
    const client = new DispatcharrClient({ url: serverUrl, token });
    const success = await client.testConnection();
    return success
      ? { success: true }
      : {
          success: false,
          code: 'CONNECTION_FAILED',
          message: 'Cannot connect to Dispatcharr with provided credentials',
        };
  }

  async getStatusSnapshot(): Promise<DispatcharrChannelStatus[]> {
    const data = await fetchJson<unknown>(`${this.baseUrl}/proxy/ts/status`, {
      headers: await this.buildHeaders(),
      service: 'dispatcharr',
      timeout: 10000,
    });
    return parseStatusResponse(data);
  }

  async getVodStatsSnapshot(): Promise<DispatcharrVodStatsResponse> {
    const data = await fetchJson<unknown>(`${this.baseUrl}/proxy/vod/stats/`, {
      headers: await this.buildHeaders(),
      service: 'dispatcharr',
      timeout: 10000,
    });

    return parseVodStatsResponse(data);
  }

  async buildSessionsFromVodStatsSnapshot(
    stats: DispatcharrVodStatsResponse,
    userById?: Map<string, MediaUser>
  ): Promise<MediaSession[]> {
    const resolvedUserMap = userById ?? (await this.getUserMap());
    return parseSessionsFromVodStats(stats, resolvedUserMap, {
      ignoreAnonymousStreams: this.ignoreAnonymousStreams,
    });
  }

  async getChannelStatus(channelId: string): Promise<DispatcharrChannelStatus | null> {
    if (!channelId || channelId === 'undefined') return null;
    return fetchJson<DispatcharrChannelStatus>(
      `${this.baseUrl}/proxy/ts/status/${encodeURIComponent(channelId)}`,
      {
        headers: await this.buildHeaders(),
        service: 'dispatcharr',
        timeout: 10000,
      }
    );
  }

  async getActiveChannelDetails(
    activeChannels: DispatcharrChannelStatus[]
  ): Promise<DispatcharrChannelStatus[]> {
    const detailResults = await Promise.allSettled(
      activeChannels.map((channel) => this.getChannelStatus(String(channel.channel_id)))
    );
    return detailResults.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    );
  }

  async getLogoPathByChannelId(channelIds: string[]): Promise<Map<string, string>> {
    const uniqIds = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqIds.length === 0) return new Map();

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/api/channels/channels/by-uuids/`, {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders()),
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

  async getCurrentProgramByChannelId(channelIds: string[]): Promise<Map<string, string>> {
    const uniqIds = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqIds.length === 0) return new Map();

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/api/epg/current-programs/`, {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders()),
          'Content-Type': 'application/json',
        },
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

  private async getResolvedOutputProfilesForChannels(
    channels: NormalizedDispatcharrChannel[]
  ): Promise<Map<number, DispatcharrResolvedOutputProfile>> {
    for (const channel of channels) {
      for (const client of channel.clients) {
        const profileId =
          typeof client.output_profile_id === 'number'
            ? Math.round(client.output_profile_id)
            : typeof client.output_profile_id === 'string' && client.output_profile_id.trim() !== ''
              ? Math.round(Number(client.output_profile_id))
              : NaN;
        if (Number.isFinite(profileId) && profileId > 0) {
          return this.getOutputProfilesById();
        }
      }
    }

    return new Map();
  }

  private async getOutputProfilesById(): Promise<Map<number, DispatcharrResolvedOutputProfile>> {
    const cached = DispatcharrClient.outputProfileCache.get(this.baseUrl);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.profilesById;
    }

    try {
      const data = await fetchJson<unknown>(`${this.baseUrl}/api/core/outputprofiles/`, {
        headers: await this.buildHeaders(),
        service: 'dispatcharr',
        timeout: 10000,
      });
      const profilesById = new Map<number, DispatcharrResolvedOutputProfile>();
      for (const record of this.extractRecords(data)) {
        const resolved = this.resolveOutputProfile(record);
        if (resolved) profilesById.set(resolved.id, resolved);
      }
      DispatcharrClient.outputProfileCache.set(this.baseUrl, {
        expiresAtMs: Date.now() + OUTPUT_PROFILE_CACHE_TTL_MS,
        profilesById,
      });
      return profilesById;
    } catch {
      return new Map();
    }
  }

  private resolveOutputProfile(
    raw: Record<string, unknown>
  ): DispatcharrResolvedOutputProfile | null {
    const profile = raw as DispatcharrOutputProfileApiRecord;
    const id = this.getOptionalInteger(profile.id);
    if (id === undefined || id <= 0) return null;

    const name = this.getOptionalString(profile.name);
    const command = this.getOptionalString(profile.command)?.toLowerCase();
    const parameters = this.getOptionalString(profile.parameters);
    if (!parameters || command !== 'ffmpeg') {
      return {
        id,
        name,
        isKnown: false,
        isTranscode: true,
        videoDecision: 'transcode',
        audioDecision: 'transcode',
      };
    }

    const args = this.tokenizeShellArgs(parameters);
    if (args.length === 0) {
      return {
        id,
        name,
        isKnown: false,
        isTranscode: true,
        videoDecision: 'transcode',
        audioDecision: 'transcode',
      };
    }

    const videoCodecArg = this.findLastArgValue(args, '-c:v', '-codec:v', '-vcodec');
    const audioCodecArg = this.findLastArgValue(args, '-c:a', '-codec:a', '-acodec');
    const outputFormatArg = this.findLastArgValue(args, '-f');
    const videoBitrate = this.parseBitrateKbps(this.findLastArgValue(args, '-b:v'));
    const audioBitrate = this.parseBitrateKbps(this.findLastArgValue(args, '-b:a'));
    const channels = this.getOptionalInteger(this.findLastArgValue(args, '-ac'));
    const frameRate = this.getOptionalString(this.findLastArgValue(args, '-r'));
    const dimensions =
      this.parseScaleFilter(this.findLastArgValue(args, '-vf')) ??
      this.parseResolutionArg(this.findLastArgValue(args, '-s'));

    const streamVideoCodec = this.normalizeCodec(videoCodecArg);
    const streamAudioCodec = this.normalizeCodec(audioCodecArg);
    const videoDecision = this.codecDecision(videoCodecArg);
    const audioDecision = this.codecDecision(audioCodecArg);
    const streamContainer = this.normalizeContainer(outputFormatArg);

    const streamVideoDetails =
      videoBitrate !== undefined ||
      frameRate !== undefined ||
      dimensions.width !== undefined ||
      dimensions.height !== undefined
        ? {
            ...(videoBitrate !== undefined ? { bitrate: videoBitrate } : {}),
            ...(frameRate !== undefined ? { framerate: frameRate } : {}),
            ...(dimensions.width !== undefined ? { width: dimensions.width } : {}),
            ...(dimensions.height !== undefined ? { height: dimensions.height } : {}),
          }
        : undefined;
    const streamAudioDetails =
      audioBitrate !== undefined || channels !== undefined
        ? {
            ...(audioBitrate !== undefined ? { bitrate: audioBitrate } : {}),
            ...(channels !== undefined ? { channels } : {}),
          }
        : undefined;

    return {
      id,
      name,
      streamContainer,
      bitrateKbps:
        videoBitrate !== undefined || audioBitrate !== undefined
          ? (videoBitrate ?? 0) + (audioBitrate ?? 0)
          : undefined,
      isKnown: true,
      isTranscode: videoDecision === 'transcode' || audioDecision === 'transcode',
      videoDecision,
      audioDecision,
      streamVideoCodec,
      streamAudioCodec,
      streamVideoDetails,
      streamAudioDetails,
    };
  }

  private getCredentialCacheKey(credentials: DispatcharrCredentials): string {
    return `${this.baseUrl}|${credentials.username}`;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    switch (this.getTokenMode()) {
      case 'jwt':
        headers.Authorization = this.token.toLowerCase().startsWith('bearer ')
          ? this.token
          : `Bearer ${this.token}`;
        break;
      case 'api-key':
        headers['X-API-Key'] = this.token;
        break;
      case 'credentials': {
        const token = await this.getCredentialAccessToken();
        headers.Authorization = `Bearer ${token}`;
        break;
      }
      default:
        break;
    }
    return headers;
  }

  private async getCredentialAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new Error('Dispatcharr credentials token is invalid');
    }

    const cacheKey = this.getCredentialCacheKey(this.credentials);
    const cached = DispatcharrClient.credentialCache.get(cacheKey);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > Date.now()) {
      return cached.accessToken;
    }

    if (cached?.refreshToken) {
      const refreshed = await this.tryRefreshCredentialToken(cached.refreshToken);
      if (refreshed) {
        DispatcharrClient.credentialCache.set(cacheKey, refreshed);
        return refreshed.accessToken;
      }
    }

    const authenticated = await this.authenticateWithCredentials(this.credentials);
    DispatcharrClient.credentialCache.set(cacheKey, authenticated);
    return authenticated.accessToken;
  }

  private async authenticateWithCredentials(
    credentials: DispatcharrCredentials
  ): Promise<DispatcharrCredentialAuthCache> {
    const data = await fetchJson<{
      access?: unknown;
      refresh?: unknown;
    }>(`${this.baseUrl}/api/accounts/token/`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password,
      }),
      service: 'dispatcharr',
      timeout: 10000,
    });
    const accessToken = typeof data.access === 'string' ? data.access.trim() : '';
    const refreshToken =
      typeof data.refresh === 'string' && data.refresh.trim() ? data.refresh.trim() : null;

    if (!accessToken) {
      throw new Error('Dispatcharr did not return an access token');
    }

    return {
      accessToken,
      refreshToken,
      expiresAtMs: decodeJwtExpiration(accessToken) ?? Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS,
    };
  }

  private async tryRefreshCredentialToken(
    refreshToken: string
  ): Promise<DispatcharrCredentialAuthCache | null> {
    try {
      const data = await fetchJson<{
        access?: unknown;
        refresh?: unknown;
      }>(`${this.baseUrl}/api/accounts/token/refresh/`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: refreshToken }),
        service: 'dispatcharr',
        timeout: 10000,
      });
      const accessToken = typeof data.access === 'string' ? data.access.trim() : '';
      if (!accessToken) return null;
      const nextRefreshToken =
        typeof data.refresh === 'string' && data.refresh.trim() ? data.refresh.trim() : refreshToken;
      return {
        accessToken,
        refreshToken: nextRefreshToken,
        expiresAtMs: decodeJwtExpiration(accessToken) ?? Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS,
      };
    } catch {
      return null;
    }
  }

  private extractRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) return payload.filter((value) => this.isRecord(value));
    if (!this.isRecord(payload)) return [];
    const candidates = [payload.results, payload.data, payload.channels, payload.programs];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((value) => this.isRecord(value));
      }
    }
    return [payload];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private getRecordString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      const str =
        typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
      if (str) return str;
    }
    return undefined;
  }

  private getOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
  }

  private getOptionalInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.round(parsed);
    }
    return undefined;
  }

  private tokenizeShellArgs(input: string): string[] {
    const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
  }

  private findLastArgValue(args: string[], ...flags: string[]): string | undefined {
    for (let index = args.length - 2; index >= 0; index -= 1) {
      if (flags.includes(args[index] ?? '')) {
        return args[index + 1];
      }
    }
    return undefined;
  }

  private parseBitrateKbps(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const match = value.trim().match(/^(\d+(?:\.\d+)?)([kKmMgG]?)$/);
    if (!match) return undefined;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const unit = match[2]?.toLowerCase() ?? '';
    if (unit === 'g') return Math.round(amount * 1_000_000);
    if (unit === 'm') return Math.round(amount * 1000);
    return Math.round(amount);
  }

  private normalizeCodec(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'copy') return undefined;
    if (normalized.includes('264')) return 'H264';
    if (normalized.includes('265') || normalized.includes('hevc')) return 'HEVC';
    if (normalized.includes('av1')) return 'AV1';
    if (normalized.includes('vp9')) return 'VP9';
    if (normalized.includes('aac')) return 'AAC';
    if (normalized.includes('ac3')) return 'AC3';
    if (normalized.includes('eac3')) return 'EAC3';
    if (normalized.includes('mp3')) return 'MP3';
    if (normalized.includes('opus')) return 'OPUS';
    return normalized.toUpperCase();
  }

  private codecDecision(value: string | undefined): string {
    return value && value.trim().toLowerCase() !== 'copy' ? 'transcode' : 'directplay';
  }

  private normalizeContainer(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'mp4' || normalized === 'fmp4') return 'FMP4';
    if (normalized === 'mpegts' || normalized === 'ts') return 'MPEGTS';
    return normalized.toUpperCase();
  }

  private parseResolutionArg(value: string | undefined): { width?: number; height?: number } {
    const match = value?.trim().match(/^(\d{2,5})x(\d{2,5})$/);
    if (!match) return {};
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  private parseScaleFilter(value: string | undefined): { width?: number; height?: number } | null {
    if (!value) return null;
    const match = value.match(/scale=(?:w=)?(-?\d{1,5})(?::|:h=)(-?\d{1,5})/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return {
      width: Number.isFinite(width) && width > 0 ? width : undefined,
      height: Number.isFinite(height) && height > 0 ? height : undefined,
    };
  }
}
