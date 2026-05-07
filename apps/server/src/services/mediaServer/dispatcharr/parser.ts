import type { MediaSession, MediaUser } from '../types.js';
import { normalizeResolution } from '../../../utils/resolutionNormalizer.js';

export interface DispatcharrClientStatus {
  client_id?: unknown;
  user_agent?: unknown;
  ip_address?: unknown;
  connected_at?: unknown;
  user_id?: unknown;
  avg_rate_KBps?: unknown;
  current_rate_KBps?: unknown;
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
  clients: DispatcharrClientStatus[];
}

export interface DispatcharrStatusResponse {
  channels?: unknown;
  count?: unknown;
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
  return normalized === 'anonymous' || normalized === 'anonymouse';
}

export function normalizeDispatcharrUserName(user: DispatcharrUserResponse): string {
  const firstName = asString(user.first_name).trim();
  const lastName = asString(user.last_name).trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || asString(user.username).trim();
}

export function parseUser(raw: unknown): MediaUser | null {
  const user = asRecord(raw);
  if (!user) return null;

  const id = asString(user.id).trim();
  const username = normalizeDispatcharrUserName(user);
  if (!id || !username || isAnonymousDispatcharrUserName(username)) return null;

  return {
    id,
    username,
    email: asOptionalString(user.email),
    isAdmin:
      Boolean(user.is_superuser) || Boolean(user.is_staff) || asNumber(user.user_level) >= 10,
    isDisabled: user.is_active === false,
  };
}

export function parseUsersResponse(raw: unknown): MediaUser[] {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)?.results)
      ? (asRecord(raw)!.results as unknown[])
      : [];

  return source.flatMap((entry) => {
    const parsed = parseUser(entry);
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
    return parsed ? [parsed as DispatcharrChannelStatus] : [];
  });
}

export function parseChannelClients(raw: unknown): DispatcharrClientStatus[] {
  const channel = asRecord(raw);
  const clients = Array.isArray(channel?.clients) ? channel.clients : [];
  return clients.flatMap((client) => {
    const parsed = asRecord(client);
    return parsed ? [parsed as DispatcharrClientStatus] : [];
  });
}

function asOptionalNumber(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed > 0 ? parsed : undefined;
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
    merged.push(record as DispatcharrClientStatus);
  }

  return merged;
}

function parseResolutionDimensions(
  resolution?: string
): { width?: number; height?: number; normalized?: string } {
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
    audioChannels: parseAudioChannels(base.audio_channels) ?? parseAudioChannels(detail?.audio_channels),
    sourceFps: asOptionalString(base.source_fps) ?? asOptionalString(detail?.source_fps),
    resolution: asOptionalString(base.resolution) ?? asOptionalString(detail?.resolution),
    clients: mergeClients(parseChannelClients(detail), parseChannelClients(base)),
  };
}

export function parseSessionsFromChannels(
  channels: NormalizedDispatcharrChannel[],
  userById: Map<string, MediaUser>,
  logoPathByChannelId?: Map<string, string>
): MediaSession[] {
  const sessions: MediaSession[] = [];

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
      if (!clientId || !userId || userId === '0') continue;

      const user = userById.get(userId);
      if (!user || isAnonymousDispatcharrUserName(user.username)) continue;

      const ipAddress = asString(client.ip_address).trim() || '0.0.0.0';
      const bitrate = Math.round(channel.avgBitrateKbps ?? 0);
      const streamProfile = (channel.streamProfile ?? '').toLowerCase();
      const isTranscode = streamProfile.includes('transcod');
      const resolution = parseResolutionDimensions(channel.resolution);

      sessions.push({
        sessionKey: `${channelId}:${clientId}`,
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
          positionMs: 0,
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
          videoDecision: isTranscode ? 'transcode' : 'directplay',
          audioDecision: isTranscode ? 'transcode' : 'directplay',
          videoResolution: resolution.normalized,
          videoWidth: resolution.width,
          videoHeight: resolution.height,
          sourceVideoCodec: channel.videoCodec,
          sourceAudioCodec: channel.audioCodec,
          sourceAudioChannels: channel.audioChannels,
          sourceVideoDetails: channel.sourceFps
            ? {
                framerate: channel.sourceFps,
                ...(bitrate > 0 ? { bitrate } : {}),
              }
            : bitrate > 0
              ? { bitrate }
              : undefined,
        },
      });
    }
  }

  return sessions;
}
