/**
 * Best-effort parser for Channels DVR's text log.
 *
 * HLS probe messages do not include a session identifier. A probe is attached
 * only when exactly one start is awaiting a probe, avoiding cross-client
 * attribution when concurrent streams make the log ambiguous.
 */
export interface ChannelsDvrLiveStreamDetails {
  ipAddress: string;
  channelNumber: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  sourceBitrateKbps?: number;
  encoder?: string;
  audioCodec?: string;
  outputBitrateKbps?: number;
}

function normalizeIp(value: string): string {
  return value.trim().toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

function sessionKey(channelNumber: string, ipAddress: string): string {
  return channelNumber + '|' + normalizeIp(ipAddress);
}

export function parseChannelsDvrStreamDetails(
  log: string
): Map<string, ChannelsDvrLiveStreamDetails> {
  const details = new Map<string, ChannelsDvrLiveStreamDetails>();
  const pendingStarts = new Map<string, string[]>();
  const pendingProbes = new Map<string, string[]>();
  const sessionKeys = new Map<string, string>();

  for (const line of log.split(/\r?\n/)) {
    const start = line.match(/\[HLS\] Starting live stream for channel (\d+) from ([^\s]+)/);
    if (start) {
      const channelNumber = start[1]!;
      const ipAddress = normalizeIp(start[2]!);
      const key = sessionKey(channelNumber, ipAddress);
      details.set(key, { channelNumber, ipAddress });
      pendingStarts.set(channelNumber, [...(pendingStarts.get(channelNumber) ?? []), key]);
      pendingProbes.set(channelNumber, [...(pendingProbes.get(channelNumber) ?? []), key]);
      continue;
    }

    const session = line.match(/\[HLS\] Session ch(\d+)-dANY-([^\s]+) started/);
    if (session) {
      const channelNumber = session[1]!;
      const suffix = session[2]!;
      if (suffix.startsWith('ip')) {
        const ipAddress = normalizeIp(suffix.slice(2));
        const key = sessionKey(channelNumber, ipAddress);
        if (!details.has(key)) details.set(key, { channelNumber, ipAddress });
      } else {
        // Channels DVR uses opaque session IDs (dANY) instead of IPs in these
        // log lines. When multiple clients start the same channel together,
        // pair each session-start with the oldest unmatched stream-start.
        // This preserves the per-client IP association for the encoder log,
        // whose session path contains the opaque ID.
        const starts = pendingStarts.get(channelNumber) ?? [];
        const [startKey, ...remainingStarts] = starts;
        if (startKey) sessionKeys.set(channelNumber + '|' + suffix, startKey);
        pendingStarts.set(channelNumber, remainingStarts);
      }
      continue;
    }

    const probe = line.match(
      /\[HLS\] Probed live stream .*?:\s*([a-zA-Z0-9_]+)\s+(\d+)x(\d+)\s+(?:progressive|interlaced)\s+(\d+)bps/
    );
    if (probe) {
      const candidates = [...pendingProbes.entries()].filter(([, keys]) => keys.length > 0);
      if (candidates.length === 1 && candidates[0]![1].length === 1) {
        const [channelNumber, keys] = candidates[0]!;
        const current = details.get(keys[0]!);
        if (current) {
          current.videoCodec = probe[1]!.toLowerCase();
          current.width = Number(probe[2]);
          current.height = Number(probe[3]);
          current.sourceBitrateKbps = Math.round(Number(probe[4]) / 1000);
        }
        pendingProbes.set(channelNumber, []);
      } else {
        for (const [channelNumber] of candidates) pendingProbes.set(channelNumber, []);
      }
      continue;
    }

    const encoder = line.match(
      /\/sessions\/ch(\d+)-dANY-([^/]+)\/encoder-[^\s]+.*?\(encoder=([^,]+),.*?acodec=([^,]+),.*?bitrate=(\d+)/
    );
    if (encoder) {
      const channelNumber = encoder[1]!;
      const suffix = encoder[2]!;
      let key: string | undefined;
      if (suffix.startsWith('ip')) {
        const ip = suffix.slice(2).match(/^(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
        if (ip) key = sessionKey(channelNumber, normalizeIp(ip));
      } else {
        key = sessionKeys.get(channelNumber + '|' + suffix.split('-')[0]);
      }
      if (!key) continue;
      const current = details.get(key);
      if (!current) continue;
      current.encoder = encoder[3]!.trim().toLowerCase();
      current.audioCodec = encoder[4]!.trim().toLowerCase();
      current.outputBitrateKbps = Number(encoder[5]);
    }
  }
  return details;
}
