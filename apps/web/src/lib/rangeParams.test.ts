import { describe, it, expect } from 'vitest';
import { withRangeParams } from './rangeParams';

describe('withRangeParams', () => {
  it('carries period, from and to and nothing else', () => {
    expect(
      withRangeParams('/stats/bandwidth', '?period=custom&from=2026-09-01&to=2026-09-30&view=me')
    ).toBe('/stats/bandwidth?period=custom&from=2026-09-01&to=2026-09-30');
  });

  it('carries the media type with the period', () => {
    expect(withRangeParams('/library/quality', '?type=show&period=week&genre=Drama')).toBe(
      '/library/quality?period=week&type=show'
    );
  });

  it('returns the href untouched when the search has no range', () => {
    expect(withRangeParams('/users', '?view=me')).toBe('/users');
  });

  it('keeps a query already on the href', () => {
    expect(withRangeParams('/stats/people?rank=data', '?period=week')).toBe(
      '/stats/people?rank=data&period=week'
    );
  });
});
