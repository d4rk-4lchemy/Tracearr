import { describe, expect, it } from 'vitest';
import { shouldWriteToDb } from '../stateTracker.js';

const baseExisting = {
  state: 'playing' as const,
  mediaTitle: 'Original Program',
  isTranscode: false,
  videoDecision: 'direct play',
  audioDecision: 'direct play',
  watched: false,
  sourceVideoCodec: 'h264',
  sourceAudioCodec: 'aac',
};

const baseProcessed = {
  state: 'playing' as const,
  mediaTitle: 'Original Program',
  isTranscode: false,
  videoDecision: 'direct play',
  audioDecision: 'direct play',
  sourceVideoCodec: 'h264',
  sourceAudioCodec: 'aac',
};

describe('shouldWriteToDb', () => {
  it('returns false when nothing changed', () => {
    expect(shouldWriteToDb(baseExisting, baseProcessed)).toBe(false);
  });

  it('returns true when state changes to paused', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, state: 'paused' })).toBe(true);
  });

  it('returns true when state changes to playing', () => {
    expect(
      shouldWriteToDb({ ...baseExisting, state: 'paused' }, { ...baseProcessed, state: 'playing' })
    ).toBe(true);
  });

  it('returns true when isTranscode changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, isTranscode: true })).toBe(true);
  });

  it('returns true when videoDecision changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, videoDecision: 'transcode' })).toBe(
      true
    );
  });

  it('returns true when audioDecision changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, audioDecision: 'transcode' })).toBe(
      true
    );
  });

  it('returns true when watched threshold reached and not already watched', () => {
    expect(shouldWriteToDb(baseExisting, baseProcessed, true)).toBe(true);
  });

  it('returns false when already watched and threshold reached again', () => {
    expect(shouldWriteToDb({ ...baseExisting, watched: true }, baseProcessed, true)).toBe(false);
  });

  it('returns true when source video codec changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, sourceVideoCodec: 'hevc' })).toBe(
      true
    );
  });

  it('returns true when source audio codec changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, sourceAudioCodec: 'eac3' })).toBe(
      true
    );
  });

  it('returns true when media title changes', () => {
    expect(shouldWriteToDb(baseExisting, { ...baseProcessed, mediaTitle: 'Next Program' })).toBe(
      true
    );
  });
});
