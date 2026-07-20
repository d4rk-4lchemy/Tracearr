import type { MediaSession, MediaUser } from '../types.js';
import { normalizeResolution } from '../../../utils/resolutionNormalizer.js';
import { calculateProgress } from '../shared/parserUtils.js';

export interface DispatcharrClientStatus {
  client_id?: unknown;
  user_agent?: unknown;
  ip_address?: unknown;
  connected_at?: unknown;
  user_id?: unknown;
  avg_rate_KBps?: unknown;
  current_rate_KBps?: unknown;
  output_format?: unknown;
  output_profile_id?: unknown;
}

export interface DispatcharrChannelStatus {
  channel_id?: unknown;
  channel_name?: unknown;
  stream_name?: unknown;
  stream_id?: unknown;
  stream_profile?: unknown;
  state?: unknown;
  client_count?: unknown;
  clients?: unknown;
  avg_bitrate_kbps?: unknown;
  avg_bitrate?: unknown;
  video_codec?: unknown;
  audio_codec?: unknown;
  audio_channels?: unknown;
  source_fps?: unknown;
  resolution?: unknown;
  ffmpeg_speed?: unknown;
}

export interface NormalizedDispatcharrChannel {
  channelId: string;
  channelName: string;
  currentProgramTitle?: string;
  streamName?: string;
  streamProfile?: string;
  state?: string;
  avgBitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  sourceFps?: string;
  resolution?: string;
  ffmpegSpeed?: number;
  clients: DispatcharrClientStatus[];
}

export interface DispatcharrResolvedOutputProfile {
  id: number;
  name?: string;
  streamContainer?: string;
  bitrateKbps?: number;
  isKnown: boolean;
  isTranscode: boolean;
  videoDecision: string;
  audioDecision: string;
  streamVideoCodec?: string;
  streamAudioCodec?: string;
  streamVideoDetails?: {
    bitrate?: number;
    width?: number;
    height?: number;
    framerate?: string;
  };
  streamAudioDetails?: {
    bitrate?: number;
    channels?: number;
  };
}

export interface DispatcharrStatusResponse {
  channels?: unknown;
  count?: unknown;
}

export interface DispatcharrVodStatsResponse {
  vod_connections?: unknown;
  total_connections?: unknown;
  timestamp?: unknown;
}

export interface DispatcharrCatchupStatsResponse {
  timeshift_sessions?: unknown;
  total_connections?: unknown;
  timestamp?: unknown;
}

export interface DispatcharrCatchupSessionGroup {
  session_id?: unknown;
  stats_channel_id?: unknown;
  channel_id?: unknown;
  channel_uuid?: unknown;
  channel_name?: unknown;
  logo_id?: unknown;
  programme_start?: unknown;
  position_anchor_at?: unknown;
  playback_base_secs?: unknown;
  paused?: unknown;
  resolution?: unknown;
  source_fps?: unknown;
  video_codec?: unknown;
  audio_codec?: unknown;
  audio_channels?: unknown;
  stream_type?: unknown;
  connection_count?: unknown;
  connections?: unknown;
}

export interface DispatcharrCatchupConnection {
  client_id?: unknown;
  session_id?: unknown;
  ip_address?: unknown;
  user_agent?: unknown;
  user_id?: unknown;
  username?: unknown;
  connected_at?: unknown;
  duration?: unknown;
  bytes_streamed?: unknown;
  avg_bitrate_kbps?: unknown;
  m3u_profile?: unknown;
  m3u_profile_id?: unknown;
}

export interface DispatcharrCatchupProgramme {
  session_id?: unknown;
  channel_uuid?: unknown;
  programme_start?: unknown;
  title?: unknown;
  sub_title?: unknown;
  description?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  duration_secs?: unknown;
}

export interface DispatcharrVodConnectionGroup {
  content_type?: unknown;
  content_name?: unknown;
  content_uuid?: unknown;
  content_metadata?: unknown;
  connection_count?: unknown;
  connections?: unknown;
}

export interface DispatcharrVodConnection {
  content_type?: unknown;
  content_name?: unknown;
  content_uuid?: unknown;
  content_metadata?: unknown;
  client_id?: unknown;
  client_ip?: unknown;
  user_id?: unknown;
  user_agent?: unknown;
  position_seconds?: unknown;
  last_known_position?: unknown;
  duration?: unknown;
  last_seek_byte?: unknown;
  total_content_size?: unknown;
  last_seek_percentage?: unknown;
}

export interface DispatcharrChannelStatsRealtimeEnvelope {
  type?: unknown;
  data?: unknown;
}

export interface DispatcharrUserResponse {
  id?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  user_level?: unknown;
  is_staff?: unknown;
  is_superuser?: unknown;
  is_active?: unknown;
}

interface DispatcharrParserOptions {
  ignoreAnonymousStreams?: boolean;
  outputProfilesById?: Map<number, DispatcharrResolvedOutputProfile>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asOptionalString(value: unknown): string | undefined {
  const str = asString(value).trim();
  return str.length > 0 ? str : undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = asString(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isPrivateIp(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  );
}

export function isAnonymousDispatcharrUserName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'anonymous';
}

function shouldIgnoreAnonymousDispatcharrUser(
  name: string,
  options?: DispatcharrParserOptions
): boolean {
  return options?.ignoreAnonymousStreams !== false && isAnonymousDispatcharrUserName(name);
}

export function normalizeDispatcharrUserName(user: DispatcharrUserResponse): string {
  const firstName = asString(user.first_name).trim();
  const lastName = asString(user.last_name).trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || asString(user.username).trim();
}

export function parseUser(raw: unknown, options?: DispatcharrParserOptions): MediaUser | null {
  const user = asRecord(raw);
  if (!user) return null;

  const id = asString(user.id).trim();
  const username = normalizeDispatcharrUserName(user);
  if (!id || !username || shouldIgnoreAnonymousDispatcharrUser(username, options)) return null;

  return {
    id,
    username,
    email: asOptionalString(user.email),
    isAdmin:
      Boolean(user.is_superuser) || Boolean(user.is_staff) || asNumber(user.user_level) >= 10,
    isDisabled: user.is_active === false,
  };
}

export function parseUsersResponse(raw: unknown, options?: DispatcharrParserOptions): MediaUser[] {
  const record = asRecord(raw);
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.results)
      ? (record.results as unknown[])
      : [];

  return source.flatMap((entry) => {
    const parsed = parseUser(entry, options);
    return parsed ? [parsed] : [];
  });
}

export function parseStatusResponse(raw: unknown): DispatcharrChannelStatus[] {
  const record = asRecord(raw);
  const channels = Array.isArray(record?.channels)
    ? record.channels
    : Array.isArray(raw)
      ? raw
      : [];
  return channels.flatMap((channel) => {
    const parsed = asRecord(channel);
    return parsed ? [parsed] : [];
  });
}

export function parseRealtimeChannelStatsPayload(raw: unknown): DispatcharrStatusResponse | null {
  return parseRealtimeStatsPayload(raw, 'channel_stats');
}

export function parseRealtimeVodStatsPayload(raw: unknown): DispatcharrVodStatsResponse | null {
  return parseRealtimeStatsPayload(raw, 'vod_stats');
}

export function parseRealtimeCatchupStatsPayload(
  raw: unknown
): DispatcharrCatchupStatsResponse | null {
  return parseRealtimeStatsPayload(raw, 'timeshift_stats');
}

function parseRealtimeStatsPayload<T extends Record<string, unknown>>(
  raw: unknown,
  expectedType: string
): T | null {
  const envelope = asRecord(raw);
  if (!envelope) return null;

  const data = asRecord(envelope.data) ?? envelope;
  const eventType = asString(data.type).trim();
  if (eventType !== expectedType) return null;

  const rawStats = data.stats;
  if (typeof rawStats === 'string') {
    try {
      const parsed = JSON.parse(rawStats) as unknown;
      const record = asRecord(parsed);
      return record as T | null;
    } catch {
      return null;
    }
  }

  const record = asRecord(rawStats);
  return record as T | null;
}

export function parseVodStatsResponse(raw: unknown): DispatcharrVodStatsResponse {
  const record = asRecord(raw);
  if (!record) return { vod_connections: [] };

  return {
    vod_connections: Array.isArray(record.vod_connections) ? record.vod_connections : [],
    total_connections: record.total_connections,
    timestamp: record.timestamp,
  };
}

export function parseCatchupStatsResponse(raw: unknown): DispatcharrCatchupStatsResponse {
  const record = asRecord(raw);
  if (!record) return { timeshift_sessions: [] };

  return {
    timeshift_sessions: Array.isArray(record.timeshift_sessions) ? record.timeshift_sessions : [],
    total_connections: record.total_connections,
    timestamp: record.timestamp,
  };
}

function flattenVodConnections(raw: unknown): DispatcharrVodConnection[] {
  const stats = parseVodStatsResponse(raw);
  const groups = Array.isArray(stats.vod_connections) ? stats.vod_connections : [];
  const flattened: DispatcharrVodConnection[] = [];

  for (const rawGroup of groups) {
    const group = asRecord(rawGroup) as DispatcharrVodConnectionGroup | null;
    if (!group) continue;
    const groupConnections = Array.isArray(group.connections) ? group.connections : [];

    for (const rawConnection of groupConnections) {
      const connection = asRecord(rawConnection);
      if (!connection) continue;
      flattened.push({
        content_type: connection.content_type ?? group.content_type,
        content_name: connection.content_name ?? group.content_name,
        content_uuid: connection.content_uuid ?? group.content_uuid,
        content_metadata: connection.content_metadata ?? group.content_metadata,
        client_id: connection.client_id,
        client_ip: connection.client_ip,
        user_id: connection.user_id,
        user_agent: connection.user_agent,
        position_seconds: connection.position_seconds,
        last_known_position: connection.last_known_position,
        duration: connection.duration,
        last_seek_byte: connection.last_seek_byte,
        total_content_size: connection.total_content_size,
        last_seek_percentage: connection.last_seek_percentage,
      });
    }
  }

  return flattened;
}

export function parseChannelClients(raw: unknown): DispatcharrClientStatus[] {
  const channel = asRecord(raw);
  const clients = Array.isArray(channel?.clients) ? channel.clients : [];
  return clients.flatMap((client) => {
    const parsed = asRecord(client);
    return parsed ? [parsed] : [];
  });
}

function asOptionalInteger(value: unknown): number | undefined {
  const parsed = asOptionalNumber(value);
  return parsed !== undefined ? Math.round(parsed) : undefined;
}

function mergeClients(
  primary: DispatcharrClientStatus[],
  secondary: DispatcharrClientStatus[]
): DispatcharrClientStatus[] {
  if (primary.length === 0) return secondary;
  if (secondary.length === 0) return primary;
  const seen = new Set<string>();
  const merged: DispatcharrClientStatus[] = [];

  for (const client of [...primary, ...secondary]) {
    const record = asRecord(client);
    if (!record) continue;
    const clientId = asString(record.client_id).trim();
    if (!clientId) continue;
    if (seen.has(clientId)) continue;
    seen.add(clientId);
    merged.push(record);
  }

  return merged;
}

function parseResolutionDimensions(resolution?: string): {
  width?: number;
  height?: number;
  normalized?: string;
} {
  const value = resolution?.trim();
  if (!value) return {};

  // Common Dispatcharr format: "1920x1080" (or with spaces)
  const match = value.match(/^(\d{3,5})\s*[xX]\s*(\d{3,5})$/);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    const normalized = normalizeResolution({ width, height }) ?? value;
    return { width, height, normalized };
  }

  return { normalized: normalizeResolution({ resolution: value }) ?? value };
}

function parseAudioChannels(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'mono') return 1;
  if (normalized === 'stereo') return 2;
  if (normalized === '5.1') return 6;
  if (normalized === '7.1') return 8;

  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }

  return undefined;
}

function parseConnectedAtElapsedMs(connectedAt: unknown, nowMs: number): number {
  const connectedAtSeconds = asNumber(connectedAt);
  if (connectedAtSeconds <= 0) return 0;

  const connectedAtMs = Math.floor(connectedAtSeconds * 1000);
  if (!Number.isFinite(connectedAtMs)) return 0;

  return Math.max(0, nowMs - connectedAtMs);
}

function normalizeOutputFormat(value: unknown): string | undefined {
  const normalized = asString(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'ts' || normalized === 'mpegts') return 'MPEGTS';
  if (normalized === 'mp4' || normalized === 'fmp4') return 'FMP4';
  return normalized.toUpperCase();
}

function estimateVodPositionSeconds(
  connection: DispatcharrVodConnection,
  durationSeconds: number
): number {
  const clamp = (value: number): number => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (durationSeconds > 0) return Math.min(durationSeconds, Math.floor(value));
    return Math.floor(value);
  };

  const positionSeconds = asNumber(connection.position_seconds);
  if (positionSeconds > 0) return clamp(positionSeconds);

  const lastKnownPosition = asNumber(connection.last_known_position);
  if (lastKnownPosition > 0) return clamp(lastKnownPosition);

  const lastSeekByte = asNumber(connection.last_seek_byte);
  const totalContentSize = asNumber(connection.total_content_size);
  if (lastSeekByte > 0 && totalContentSize > 0 && durationSeconds > 0) {
    return clamp((lastSeekByte / totalContentSize) * durationSeconds);
  }

  const rawSeekPercent = asNumber(connection.last_seek_percentage);
  if (rawSeekPercent > 0 && durationSeconds > 0) {
    const normalizedSeekRatio = rawSeekPercent > 1 ? rawSeekPercent / 100 : rawSeekPercent;
    return clamp(normalizedSeekRatio * durationSeconds);
  }

  return 0;
}

function flattenCatchupSessions(
  raw: unknown
): Array<DispatcharrCatchupSessionGroup & { connections: DispatcharrCatchupConnection[] }> {
  const stats = parseCatchupStatsResponse(raw);
  const groups = Array.isArray(stats.timeshift_sessions) ? stats.timeshift_sessions : [];

  return groups.flatMap((rawGroup) => {
    const groupRecord = asRecord(rawGroup);
    const group: DispatcharrCatchupSessionGroup | null = groupRecord;
    if (!group) return [];
    const connections = Array.isArray(group.connections)
      ? group.connections.flatMap((rawConnection) => {
          const connectionRecord = asRecord(rawConnection);
          const connection: DispatcharrCatchupConnection | null = connectionRecord;
          return connection ? [connection] : [];
        })
      : [];
    return [{ ...group, connections }];
  });
}

function buildCatchupMediaTitle(programme: DispatcharrCatchupProgramme | null): string {
  if (!programme) return '';
  const title = asOptionalString(programme.title) ?? '';
  const subTitle = asOptionalString(programme.sub_title) ?? '';
  return title && subTitle ? `${title} - ${subTitle}` : title;
}

function normalizeUtcIso(value: unknown): string | undefined {
  const raw = asOptionalString(value);
  if (!raw) return undefined;

  const match = raw.match(
    /^(?<date>\d{4}-\d{2}-\d{2}):(?<hour>\d{2})-(?<minute>\d{2})(?:[:-](?<second>\d{2}))?$/
  );
  const normalizedWallClock = match?.groups
    ? `${match.groups.date}T${match.groups.hour}:${match.groups.minute}:${match.groups.second ?? '00'}Z`
    : raw;

  const parsedMs = Date.parse(normalizedWallClock);
  if (!Number.isFinite(parsedMs)) return undefined;
  return new Date(parsedMs).toISOString();
}

export function parseDispatcharrCatchupTimestampMs(value: unknown): number | null {
  const normalized = normalizeUtcIso(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateCatchupPositionSeconds(
  session: DispatcharrCatchupSessionGroup,
  programme: DispatcharrCatchupProgramme | null,
  baseProgramme: DispatcharrCatchupProgramme | null,
  nowSeconds: number
): number | null {
  const paused = asBoolean(session.paused);
  const positionAnchorAt = asOptionalNumber(session.position_anchor_at);
  const playbackBaseSecs = asOptionalNumber(session.playback_base_secs);
  const currentStartMs = Date.parse(asOptionalString(programme?.start_time) ?? '');
  const baseStartMs = Date.parse(asOptionalString(baseProgramme?.start_time) ?? '');
  const rawProgrammeStartMs = parseDispatcharrCatchupTimestampMs(session.programme_start);

  if (playbackBaseSecs !== undefined) {
    const elapsedSinceAnchor =
      !paused && positionAnchorAt !== undefined ? nowSeconds - positionAnchorAt : 0;
    let positionSecs = Math.max(0, playbackBaseSecs + Math.max(0, elapsedSinceAnchor));

    if (Number.isFinite(currentStartMs) && Number.isFinite(baseStartMs)) {
      positionSecs += Math.max(0, (baseStartMs - currentStartMs) / 1000);
    }

    const durationSecs = asOptionalNumber(programme?.duration_secs);
    if (durationSecs !== undefined) {
      positionSecs = Math.min(positionSecs, durationSecs);
    }
    return positionSecs;
  }

  if (!Number.isFinite(currentStartMs) || rawProgrammeStartMs === null) {
    return null;
  }

  const elapsedSinceAnchor =
    !paused && positionAnchorAt !== undefined ? nowSeconds - positionAnchorAt : 0;
  let positionSecs = Math.max(
    0,
    (rawProgrammeStartMs - currentStartMs) / 1000 + Math.max(0, elapsedSinceAnchor)
  );
  const durationSecs = asOptionalNumber(programme?.duration_secs);
  if (durationSecs !== undefined) {
    positionSecs = Math.min(positionSecs, durationSecs);
  }
  return positionSecs;
}

export function parseCatchupProgrammesResponse(raw: unknown): DispatcharrCatchupProgramme[] {
  const record = asRecord(raw);
  const source = Array.isArray(record?.sessions) ? record.sessions : Array.isArray(raw) ? raw : [];
  return source.flatMap((entry) => {
    const parsedRecord = asRecord(entry);
    const parsed: DispatcharrCatchupProgramme | null = parsedRecord;
    return parsed ? [parsed] : [];
  });
}

export function parseSessionsFromCatchupStats(
  raw: unknown,
  userById: Map<string, MediaUser>,
  programmesBySessionId?: Map<string, DispatcharrCatchupProgramme>,
  baseProgrammesBySessionId?: Map<string, DispatcharrCatchupProgramme>,
  options?: DispatcharrParserOptions
): MediaSession[] {
  const nowSeconds = Date.now() / 1000;
  const ignoreAnonymousStreams = options?.ignoreAnonymousStreams !== false;
  const sessions: MediaSession[] = [];

  for (const group of flattenCatchupSessions(raw)) {
    const sessionId = asString(group.session_id).trim();
    const channelUuid = asString(group.channel_uuid).trim();
    const channelId = asString(group.channel_id).trim();
    const channelName = asString(group.channel_name).trim() || 'Catch-up';
    if (!sessionId || !channelUuid) continue;

    const programme = programmesBySessionId?.get(sessionId) ?? null;
    const baseProgramme = baseProgrammesBySessionId?.get(sessionId) ?? null;
    const channelIdentifier = channelUuid || channelId;
    const sessionKey = `catchup:${sessionId}:${channelIdentifier}`;
    const mediaId = channelIdentifier;
    const mediaTitle = buildCatchupMediaTitle(programme);
    const fallbackTitle = mediaTitle || channelName;
    const durationSecs = asOptionalNumber(programme?.duration_secs);
    const positionSecs = estimateCatchupPositionSeconds(
      group,
      programme,
      baseProgramme,
      nowSeconds
    );
    const catchupAnchorAt = normalizeUtcIso(group.programme_start);
    const catchupEpgStartAt = normalizeUtcIso(programme?.start_time);
    const catchupEpgEndAt = normalizeUtcIso(programme?.end_time);
    const positionMs = positionSecs !== null ? Math.max(0, Math.round(positionSecs * 1000)) : 0;
    const durationMs =
      durationSecs !== undefined ? Math.max(0, Math.round(durationSecs * 1000)) : 0;
    const logoId = asOptionalString(group.logo_id);
    const channelThumb = logoId
      ? `/api/channels/logos/${encodeURIComponent(logoId)}/cache/`
      : undefined;
    const sourceFps = asOptionalString(group.source_fps);
    const audioChannels = asOptionalInteger(group.audio_channels);
    const videoCodec = asOptionalString(group.video_codec);
    const audioCodec = asOptionalString(group.audio_codec);
    const resolution = parseResolutionDimensions(asOptionalString(group.resolution));

    for (const connection of group.connections) {
      const clientId = asString(connection.client_id).trim() || sessionId;
      const userId = asString(connection.user_id).trim();
      if (!userId) continue;

      const fallbackAnonymousUser =
        !ignoreAnonymousStreams && userId === '0'
          ? ({ id: userId, username: 'Anonymous', isAdmin: false } as MediaUser)
          : null;
      const user = userById.get(userId) ?? fallbackAnonymousUser;
      if (!user) continue;
      if (shouldIgnoreAnonymousDispatcharrUser(user.username, options)) continue;

      const ipAddress = asString(connection.ip_address).trim() || '0.0.0.0';
      sessions.push({
        sessionKey,
        terminationKey: sessionId,
        dispatcharrPlaybackKind: 'catchup',
        progressEstimated: true,
        dispatcharrCatchupAnchorAt: catchupAnchorAt,
        dispatcharrCatchupEpgStartAt: catchupEpgStartAt,
        dispatcharrCatchupEpgEndAt: catchupEpgEndAt,
        dispatcharrCatchupProgrammeStart: asOptionalString(group.programme_start),
        dispatcharrCatchupPositionAnchorAt: asOptionalNumber(group.position_anchor_at),
        dispatcharrCatchupPlaybackBaseSecs: asOptionalNumber(group.playback_base_secs),
        mediaId,
        user: {
          id: user.id,
          username: user.username,
          thumb: user.thumb,
        },
        media: {
          title: fallbackTitle,
          type: 'live',
          durationMs,
          thumbPath: channelThumb,
        },
        live: {
          channelTitle: channelName,
          channelIdentifier: channelUuid || channelId,
          channelThumb,
        },
        playback: {
          state: asBoolean(group.paused) ? 'paused' : 'playing',
          positionMs,
          progressPercent: durationMs > 0 ? calculateProgress(positionMs, durationMs) : 0,
        },
        player: {
          name: asString(connection.user_agent).trim() || 'Dispatcharr Catch-up Client',
          deviceId: clientId,
          product: asOptionalString(connection.user_agent),
          platform: 'Dispatcharr',
        },
        network: {
          ipAddress,
          isLocal: isPrivateIp(ipAddress),
        },
        quality: {
          bitrate: Math.round(asNumber(connection.avg_bitrate_kbps)),
          isTranscode: false,
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          videoResolution: resolution.normalized,
          videoWidth: resolution.width,
          videoHeight: resolution.height,
          sourceVideoCodec: videoCodec,
          sourceAudioCodec: audioCodec,
          sourceAudioChannels: audioChannels,
          sourceVideoDetails: sourceFps ? { framerate: sourceFps } : undefined,
        },
      });
    }
  }

  return sessions;
}

export function parseSessionsFromVodStats(
  raw: unknown,
  userById: Map<string, MediaUser>,
  options?: DispatcharrParserOptions
): MediaSession[] {
  const sessions: MediaSession[] = [];
  const ignoreAnonymousStreams = options?.ignoreAnonymousStreams !== false;

  for (const connection of flattenVodConnections(raw)) {
    const clientId = asString(connection.client_id).trim();
    const userId = asString(connection.user_id).trim();
    const mediaId = asString(connection.content_uuid).trim();
    const rawType = asString(connection.content_type).trim().toLowerCase();
    const mediaType = rawType === 'movie' || rawType === 'episode' ? rawType : 'unknown';
    if (!clientId || !userId || !mediaId || (mediaType !== 'movie' && mediaType !== 'episode')) {
      continue;
    }

    const fallbackAnonymousUser =
      !ignoreAnonymousStreams && userId === '0'
        ? ({
            id: userId,
            username: 'Anonymous',
            isAdmin: false,
          } as MediaUser)
        : null;
    const user = userById.get(userId) ?? fallbackAnonymousUser;
    if (!user) continue;
    if (shouldIgnoreAnonymousDispatcharrUser(user.username, options)) continue;

    const metadata = asRecord(connection.content_metadata);
    const durationSeconds = Math.max(0, Math.round(asNumber(metadata?.duration_secs)));
    const durationMs = durationSeconds * 1000;
    const positionSeconds = estimateVodPositionSeconds(connection, durationSeconds);
    const positionMs = Math.max(0, Math.round(positionSeconds * 1000));
    const mediaTitle =
      mediaType === 'episode'
        ? asString(metadata?.episode_name).trim() || asString(connection.content_name).trim()
        : asString(connection.content_name).trim();
    if (!mediaTitle) continue;

    const logoUrl = asOptionalString(metadata?.logo_url);
    const ipAddress = asString(connection.client_ip).trim() || '0.0.0.0';
    const userAgent = asOptionalString(connection.user_agent);
    const yearValue =
      mediaType === 'movie' ? asNumber(metadata?.year) : asNumber(metadata?.series_year);
    const year = yearValue > 0 ? Math.round(yearValue) : undefined;
    const seasonValue = Math.round(asNumber(metadata?.season_number));
    const episodeValue = Math.round(asNumber(metadata?.episode_number));

    sessions.push({
      sessionKey: clientId,
      terminationKey: clientId,
      dispatcharrPlaybackKind: 'vod',
      progressEstimated: false,
      mediaId,
      user: {
        id: user.id,
        username: user.username,
        thumb: user.thumb,
      },
      media: {
        title: mediaTitle,
        type: mediaType,
        durationMs,
        year,
        thumbPath: logoUrl,
      },
      episode:
        mediaType === 'episode'
          ? {
              showTitle: asString(metadata?.series_name).trim() || 'Unknown Series',
              seasonNumber: seasonValue > 0 ? seasonValue : 0,
              episodeNumber: episodeValue > 0 ? episodeValue : 0,
              showThumbPath: logoUrl,
            }
          : undefined,
      playback: {
        state: 'playing',
        positionMs,
        progressPercent: calculateProgress(positionMs, durationMs),
      },
      player: {
        name: userAgent ?? 'Dispatcharr VOD Client',
        deviceId: clientId,
        product: userAgent,
        platform: 'Dispatcharr',
      },
      network: {
        ipAddress,
        isLocal: isPrivateIp(ipAddress),
      },
      quality: {
        bitrate: 0,
        isTranscode: false,
        videoDecision: 'directplay',
        audioDecision: 'directplay',
      },
    });
  }

  return sessions;
}

export function normalizeDispatcharrChannel(
  baseChannel: DispatcharrChannelStatus,
  detailChannel?: DispatcharrChannelStatus | null
): NormalizedDispatcharrChannel | null {
  const base = asRecord(baseChannel);
  if (!base) return null;
  const detail = asRecord(detailChannel);

  const channelId =
    asString(base.channel_id).trim() || asString(detail?.channel_id).trim() || undefined;
  if (!channelId) return null;

  const channelName =
    asString(base.channel_name).trim() ||
    asString(detail?.channel_name).trim() ||
    asString(base.stream_name).trim() ||
    asString(detail?.stream_name).trim() ||
    `Channel ${channelId}`;

  return {
    channelId,
    channelName,
    streamName: asOptionalString(base.stream_name) ?? asOptionalString(detail?.stream_name),
    streamProfile:
      asOptionalString(base.stream_profile) ?? asOptionalString(detail?.stream_profile),
    state: asOptionalString(base.state) ?? asOptionalString(detail?.state),
    avgBitrateKbps:
      asOptionalNumber(base.avg_bitrate_kbps) ??
      asOptionalNumber(detail?.avg_bitrate_kbps) ??
      asOptionalNumber(base.avg_bitrate) ??
      asOptionalNumber(detail?.avg_bitrate),
    videoCodec: asOptionalString(base.video_codec) ?? asOptionalString(detail?.video_codec),
    audioCodec: asOptionalString(base.audio_codec) ?? asOptionalString(detail?.audio_codec),
    audioChannels:
      parseAudioChannels(base.audio_channels) ?? parseAudioChannels(detail?.audio_channels),
    sourceFps: asOptionalString(base.source_fps) ?? asOptionalString(detail?.source_fps),
    resolution: asOptionalString(base.resolution) ?? asOptionalString(detail?.resolution),
    ffmpegSpeed: asOptionalNumber(base.ffmpeg_speed) ?? asOptionalNumber(detail?.ffmpeg_speed),
    clients: mergeClients(parseChannelClients(detail), parseChannelClients(base)),
  };
}

export function parseSessionsFromChannels(
  channels: NormalizedDispatcharrChannel[],
  userById: Map<string, MediaUser>,
  logoPathByChannelId?: Map<string, string>,
  options?: DispatcharrParserOptions
): MediaSession[] {
  const sessions: MediaSession[] = [];
  const nowMs = Date.now();
  const ignoreAnonymousStreams = options?.ignoreAnonymousStreams !== false;

  for (const channel of channels) {
    const channelId = channel.channelId.trim();
    if (!channelId) continue;

    const channelTitle = channel.channelName;
    const mediaTitle = channel.currentProgramTitle?.trim() || channelTitle;
    const clients = channel.clients;
    const channelThumb = logoPathByChannelId?.get(channelId);

    for (const client of clients) {
      const clientId = asString(client.client_id).trim();
      const userId = asString(client.user_id).trim();
      if (!clientId || !userId) continue;

      const fallbackAnonymousUser =
        !ignoreAnonymousStreams && userId === '0'
          ? ({
              id: userId,
              username: 'Anonymous',
              isAdmin: false,
            } as MediaUser)
          : null;
      const user = userById.get(userId) ?? fallbackAnonymousUser;
      if (!user) continue;
      if (shouldIgnoreAnonymousDispatcharrUser(user.username, options)) continue;

      const ipAddress = asString(client.ip_address).trim() || '0.0.0.0';
      const clientOutputFormat = normalizeOutputFormat(client.output_format);
      const outputProfileId = asOptionalInteger(client.output_profile_id);
      const outputProfile =
        outputProfileId !== undefined
          ? options?.outputProfilesById?.get(outputProfileId)
          : undefined;
      const streamProfile = (channel.streamProfile ?? '').toLowerCase();
      const fallbackIsTranscode = streamProfile.includes('transcod');
      const resolution = parseResolutionDimensions(channel.resolution);
      const hasOutputProfile = outputProfileId !== undefined;
      const transcodeSpeed = hasOutputProfile ? undefined : channel.ffmpegSpeed;
      const inferredContainer = outputProfile?.streamContainer ?? clientOutputFormat;
      const containerChanged = inferredContainer === 'FMP4';
      const conservativeUnknownProfile = outputProfileId !== undefined && !outputProfile;
      const videoDecision =
        outputProfile?.videoDecision ??
        (conservativeUnknownProfile
          ? 'transcode'
          : fallbackIsTranscode
            ? 'transcode'
            : 'directplay');
      const audioDecision =
        outputProfile?.audioDecision ??
        (conservativeUnknownProfile
          ? 'transcode'
          : fallbackIsTranscode
            ? 'transcode'
            : 'directplay');
      const isTranscode =
        outputProfile?.isTranscode ?? (conservativeUnknownProfile ? true : fallbackIsTranscode);
      const bitrate = Math.round(outputProfile?.bitrateKbps ?? channel.avgBitrateKbps ?? 0);
      const transcodeReasons = conservativeUnknownProfile
        ? ['Dispatcharr output profile active']
        : outputProfile
          ? [`Dispatcharr output profile: ${outputProfile.name ?? outputProfile.id}`]
          : undefined;
      const transcodeInfo =
        transcodeSpeed !== undefined ||
        inferredContainer !== undefined ||
        transcodeReasons !== undefined
          ? {
              ...(inferredContainer
                ? { sourceContainer: 'MPEGTS', streamContainer: inferredContainer }
                : {}),
              ...(containerChanged ? { containerDecision: 'transcode' } : {}),
              ...(transcodeSpeed !== undefined ? { speed: transcodeSpeed } : {}),
              ...(transcodeReasons ? { reasons: transcodeReasons } : {}),
            }
          : undefined;

      sessions.push({
        sessionKey: `${channelId}:${clientId}`,
        terminationKey: `${channelId}:${clientId}`,
        dispatcharrPlaybackKind: 'live',
        progressEstimated: false,
        mediaId: channelId,
        user: {
          id: user.id,
          username: user.username,
          thumb: user.thumb,
        },
        media: {
          title: mediaTitle,
          type: 'live',
          durationMs: 0,
        },
        live: {
          channelTitle,
          channelIdentifier: channelId,
          channelThumb,
        },
        playback: {
          state: (channel.state ?? '').toLowerCase() === 'buffering' ? 'buffering' : 'playing',
          positionMs: parseConnectedAtElapsedMs(client.connected_at, nowMs),
          progressPercent: 0,
        },
        player: {
          name: asString(client.user_agent).trim() || 'Dispatcharr Client',
          deviceId: clientId,
          product: asOptionalString(client.user_agent),
          platform: 'Dispatcharr',
        },
        network: {
          ipAddress,
          isLocal: isPrivateIp(ipAddress),
        },
        quality: {
          bitrate,
          isTranscode,
          videoDecision,
          audioDecision,
          transcodeInfo,
          videoResolution: resolution.normalized,
          videoWidth: resolution.width,
          videoHeight: resolution.height,
          sourceVideoCodec: channel.videoCodec,
          sourceAudioCodec: channel.audioCodec,
          sourceAudioChannels: channel.audioChannels,
          streamVideoCodec: outputProfile?.streamVideoCodec,
          streamAudioCodec: outputProfile?.streamAudioCodec,
          streamVideoDetails: outputProfile?.streamVideoDetails,
          streamAudioDetails: outputProfile?.streamAudioDetails,
          sourceVideoDetails: channel.sourceFps
            ? {
                framerate: channel.sourceFps,
              }
            : undefined,
        },
      });
    }
  }

  return sessions;
}
