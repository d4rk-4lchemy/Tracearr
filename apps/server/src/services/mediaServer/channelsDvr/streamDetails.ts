/**
 * Best-effort parser for Channels DVR's text log.
 *
 * The DVR log is undocumented, so this parser only uses observed HLS/ENC
 * messages and leaves fields unknown when the server does not report them.
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
  return `${channelNumber}| ${normalizeIp(ipAddress)}`.replace('| ', '|');
}

/**
 * Parse the most recent HLS playback attempt for each client IP and channel.
 * A new "Starting live stream" line resets the previous attempt, so cancelled
 * probes cannot inherit details from an older playback.
 */
export function parseChannelsDvrStreamDetails(
  log: string
): Map<string, ChannelsDvrLiveStreamDetails> {
  const details = new Map<string, ChannelsDvrLiveStreamDetails>();
  let currentKey: string | null = null;

  for (const line of log.split(/\r?\n/)) {
    const start = line.match(/\[HLS\] Starting live stream for channel (\d+) from ([^\s]+)/);
    if (start) {
      const channelNumber = start[1]!;
      const ipAddress = normalizeIp(start[2]!);
      currentKey = sessionKey(channelNumber, ipAddress);
      details.set(currentKey, { channelNumber, ipAddress });
      continue;
    }

    // The session identifier repeats the client IP and is more reliable than
    // relying only on whichever "Starting" line appeared most recently.
    const session = line.match(/\[HLS\] Session ch(\d+)-dANY-ip([^\s]+) started/);
    if (session) {
      const channelNumber = session[1]!;
      const ipAddress = normalizeIp(session[2]!);
      currentKey = sessionKey(channelNumber, ipAddress);
      if (!details.has(currentKey)) {
        details.set(currentKey, { channelNumber, ipAddress });
      }
      continue;
    }

    const probe = line.match(
      /\[HLS\] Probed live stream .*?:\s*([a-zA-Z0-9_]+)\s+(\d+)x(\d+)\s+(?:progressive|interlaced)\s+(\d+)bps/
    );
    if (probe && currentKey) {
      const current = details.get(currentKey);
      if (current) {
        current.videoCodec = probe[1]!.toLowerCase();
        current.width = Number(probe[2]);
        current.height = Number(probe[3]);
        current.sourceBitrateKbps = Math.round(Number(probe[4]) / 1000);
      }
      continue;
    }

    const encoder = line.match(
      /\/sessions\/ch(\d+)-dANY-ip((?:\d{1,3}\.){3}\d{1,3})[^/]*\/encoder-[^\s]+.*?\(encoder=([^,]+),\s*acodec=([^,]+),\s*bitrate=(\d+)/
    );
    if (encoder) {
      const channelNumber = encoder[1]!;
      const ipAddress = normalizeIp(encoder[2]!);
      const key = sessionKey(channelNumber, ipAddress);
      const current = details.get(key) ?? { channelNumber, ipAddress };
      current.encoder = encoder[3]!.trim().toLowerCase();
      current.audioCodec = encoder[4]!.trim().toLowerCase();
      current.outputBitrateKbps = Number(encoder[5]);
      details.set(key, current);
    }
  }

  return details;
}
