import { describe, expect, it } from 'vitest';
import { isSubtitleBurnIn, playbackDecision } from '../playbackDecision.js';

describe('playbackDecision', () => {
  it('is a transcode whenever the session transcodes, whatever the stream decisions say', () => {
    expect(playbackDecision({ isTranscode: true, videoDecision: 'copy' })).toBe('transcode');
  });

  it('is an audio transcode when only the audio transcodes', () => {
    expect(
      playbackDecision({ isTranscode: true, videoDecision: 'copy', audioDecision: 'transcode' })
    ).toBe('audio_transcode');
    expect(
      playbackDecision({ isTranscode: true, videoDecision: null, audioDecision: 'transcode' })
    ).toBe('audio_transcode');
  });

  it('is a transcode when the video transcodes, whatever the audio does', () => {
    expect(
      playbackDecision({
        isTranscode: true,
        videoDecision: 'transcode',
        audioDecision: 'transcode',
      })
    ).toBe('transcode');
    expect(
      playbackDecision({ isTranscode: true, videoDecision: 'transcode', audioDecision: 'copy' })
    ).toBe('transcode');
  });

  it('is a direct stream when either stream is copied', () => {
    expect(playbackDecision({ videoDecision: 'copy', audioDecision: 'directplay' })).toBe('copy');
    expect(playbackDecision({ videoDecision: 'directplay', audioDecision: 'copy' })).toBe('copy');
  });

  it('is direct play otherwise, including when the decisions are absent', () => {
    expect(playbackDecision({ videoDecision: 'directplay', audioDecision: 'directplay' })).toBe(
      'directplay'
    );
    expect(playbackDecision({ isTranscode: null, videoDecision: null })).toBe('directplay');
  });
});

describe('isSubtitleBurnIn', () => {
  it('reads the Plex subtitle decision and the Jellyfin/Emby transcode reason', () => {
    expect(isSubtitleBurnIn({ subtitleInfo: { decision: 'burn' } })).toBe(true);
    expect(
      isSubtitleBurnIn({
        transcodeInfo: { reasons: ['ContainerNotSupported', 'SubtitleCodecNotSupported'] },
      })
    ).toBe(true);
  });

  it('is false for copied subtitles, other reasons, or no data', () => {
    expect(isSubtitleBurnIn({ subtitleInfo: { decision: 'copy' } })).toBe(false);
    expect(isSubtitleBurnIn({ transcodeInfo: { reasons: ['AudioCodecNotSupported'] } })).toBe(
      false
    );
    expect(isSubtitleBurnIn({ subtitleInfo: null, transcodeInfo: null })).toBe(false);
  });
});
