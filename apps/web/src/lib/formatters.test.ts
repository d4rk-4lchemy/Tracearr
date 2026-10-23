import { describe, expect, it } from 'vitest';
import { compactCount } from './formatters';

describe('compactCount', () => {
  it('leaves values under 1000 unchanged', () => {
    expect(compactCount(999)).toBe('999');
    expect(compactCount(0)).toBe('0');
  });

  it('formats thousands with one decimal, trimmed when whole', () => {
    expect(compactCount(1204)).toBe('1.2k');
    expect(compactCount(1000)).toBe('1k');
  });

  it('formats millions', () => {
    expect(compactCount(3_400_000)).toBe('3.4M');
  });

  it('formats billions', () => {
    expect(compactCount(2_000_000_000)).toBe('2B');
  });
});
