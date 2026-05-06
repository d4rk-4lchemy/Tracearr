import type { MediaSession, MediaUser } from '../types.js';

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
  video_codec?: unknown;
  audio_codec?: unknown;
  resolution?: unknown;
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

export function parseSessionsFromChannels(
  channels: DispatcharrChannelStatus[],
  userById: Map<string, MediaUser>
): MediaSession[] {
  const sessions: MediaSession[] = [];

  for (const channel of channels) {
    const channelId = asString(channel.channel_id).trim();
    if (!channelId) continue;

    const channelTitle =
      asString(channel.channel_name).trim() ||
      asString(channel.stream_name).trim() ||
      `Channel ${channelId}`;
    const clients = parseChannelClients(channel);

    for (const client of clients) {
      const clientId = asString(client.client_id).trim();
      const userId = asString(client.user_id).trim();
      if (!clientId || !userId || userId === '0') continue;

      const user = userById.get(userId);
      if (!user || isAnonymousDispatcharrUserName(user.username)) continue;

      const ipAddress = asString(client.ip_address).trim() || '0.0.0.0';
      const bitrate = Math.round(asNumber(channel.avg_bitrate_kbps));
      const streamProfile = asString(channel.stream_profile).toLowerCase();
      const isTranscode = streamProfile.includes('transcod');

      sessions.push({
        sessionKey: `${channelId}:${clientId}`,
        mediaId: channelId,
        user: {
          id: user.id,
          username: user.username,
          thumb: user.thumb,
        },
        media: {
          title: channelTitle,
          type: 'live',
          durationMs: 0,
        },
        live: {
          channelTitle,
          channelIdentifier: channelId,
        },
        playback: {
          state: asString(channel.state).toLowerCase() === 'buffering' ? 'buffering' : 'playing',
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
          videoResolution: asOptionalString(channel.resolution),
          sourceVideoCodec: asOptionalString(channel.video_codec),
          sourceAudioCodec: asOptionalString(channel.audio_codec),
        },
      });
    }
  }

  return sessions;
}
