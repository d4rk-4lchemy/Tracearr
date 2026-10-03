import type { SubtitleInfo, TranscodeInfo } from './types.js';

export type PlaybackDecision = 'directplay' | 'copy' | 'audio_transcode' | 'transcode';

export const PLAYBACK_DECISIONS = [
  'directplay',
  'copy',
  'audio_transcode',
  'transcode',
] as const satisfies readonly PlaybackDecision[];

/** Keys in the `common` translation namespace, without the namespace prefix. */
export const PLAYBACK_DECISION_LABEL_KEYS = {
  directplay: 'playback.directPlay',
  copy: 'playback.directStream',
  audio_transcode: 'playback.audioTranscode',
  transcode: 'playback.transcode',
} as const satisfies Record<PlaybackDecision, string>;

export interface PlaybackDecisionInput {
  isTranscode?: boolean | null;
  videoDecision?: string | null;
  audioDecision?: string | null;
}

/**
 * Tiered by the costliest stream: any video transcode is a Transcode, an audio
 * transcode over untouched video is an Audio Transcode, and any copied stream
 * makes the session a Direct Stream.
 */
export function playbackDecision(session: PlaybackDecisionInput): PlaybackDecision {
  if (session.isTranscode) {
    return session.audioDecision === 'transcode' && session.videoDecision !== 'transcode'
      ? 'audio_transcode'
      : 'transcode';
  }
  return session.videoDecision === 'copy' || session.audioDecision === 'copy'
    ? 'copy'
    : 'directplay';
}

export interface SubtitleBurnInInput {
  subtitleInfo?: Pick<SubtitleInfo, 'decision'> | null;
  transcodeInfo?: Pick<TranscodeInfo, 'reasons'> | null;
}

/**
 * Plex marks the subtitle stream `burn`; Jellyfin and Emby only list a subtitle
 * transcode reason, and only when the server decides to burn in, not when the
 * user forces it.
 */
export function isSubtitleBurnIn(session: SubtitleBurnInInput): boolean {
  return (
    session.subtitleInfo?.decision === 'burn' ||
    (session.transcodeInfo?.reasons?.includes('SubtitleCodecNotSupported') ?? false)
  );
}
