import { describe, it, expect } from 'vitest';
import { getPersonRemovedState } from './removedStatus';

describe('getPersonRemovedState', () => {
  it('is not removed when there is no server data (no crash, no badge)', () => {
    expect(getPersonRemovedState(undefined)).toEqual({ removed: false });
    expect(getPersonRemovedState([])).toEqual({ removed: false });
  });

  it('is removed when the single account is removed (unmerged identity)', () => {
    const removedAt = '2026-01-01T00:00:00Z';
    expect(getPersonRemovedState([{ removedAt }])).toEqual({ removed: true, removedAt });
  });

  it('is not removed when the single account is still active', () => {
    expect(getPersonRemovedState([{ removedAt: null }])).toEqual({ removed: false });
  });

  it('is not removed when a merged identity still has at least one active account', () => {
    expect(
      getPersonRemovedState([{ removedAt: '2026-01-01T00:00:00Z' }, { removedAt: null }])
    ).toEqual({ removed: false });
  });

  it('is removed once every account in a merged identity is removed, using the latest date', () => {
    const earlier = '2026-01-01T00:00:00Z';
    const later = '2026-02-01T00:00:00Z';
    expect(getPersonRemovedState([{ removedAt: earlier }, { removedAt: later }])).toEqual({
      removed: true,
      removedAt: later,
    });
  });

  it('accepts Date instances as well as ISO strings', () => {
    const removedAt = new Date('2026-01-01T00:00:00Z');
    expect(getPersonRemovedState([{ removedAt }])).toEqual({ removed: true, removedAt });
  });
});
