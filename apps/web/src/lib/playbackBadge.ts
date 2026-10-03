import { AudioLines, Cpu, MonitorPlay, Package, Zap, type LucideIcon } from 'lucide-react';
import {
  isSubtitleBurnIn,
  playbackDecision,
  type PlaybackDecision,
  type PlaybackDecisionInput,
  type SubtitleInfo,
  type TranscodeInfo,
} from '@tracearr/shared';

export const PLAYBACK_DECISION_ICONS: Record<PlaybackDecision, LucideIcon> = {
  directplay: MonitorPlay,
  copy: Package,
  audio_transcode: AudioLines,
  transcode: Zap,
};

export function playbackBadge(
  session: PlaybackDecisionInput & {
    transcodeInfo?: TranscodeInfo | null;
    subtitleInfo?: SubtitleInfo | null;
  }
): {
  decision: PlaybackDecision;
  Icon: LucideIcon;
  variant: 'success' | 'warning';
  isHwTranscode: boolean;
  isBurnIn: boolean;
} {
  const decision = playbackDecision(session);
  const isHwTranscode =
    decision === 'transcode' &&
    !!(session.transcodeInfo?.hwEncoding || session.transcodeInfo?.hwDecoding);
  return {
    decision,
    Icon: isHwTranscode ? Cpu : PLAYBACK_DECISION_ICONS[decision],
    variant: decision === 'transcode' ? 'warning' : 'success',
    isHwTranscode,
    isBurnIn: isSubtitleBurnIn(session),
  };
}
