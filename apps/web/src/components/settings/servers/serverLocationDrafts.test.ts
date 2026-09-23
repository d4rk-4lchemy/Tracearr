import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import {
  draftsKey,
  effectiveFromOf,
  emptyDraft,
  toDrafts,
  toEntries,
} from './serverLocationDrafts';

describe('effectiveFromOf', () => {
  // A zone off UTC, so parsing the day as UTC gives a different instant than local midnight.
  beforeAll(() => {
    vi.stubEnv('TZ', 'America/Chicago');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('is local midnight of the picked day', () => {
    expect(effectiveFromOf('2024-03-01')).toBe('2024-03-01T06:00:00.000Z');
  });

  it('round-trips a dated entry to the same instant', () => {
    const effectiveFrom = '2024-03-01T06:00:00.000Z';
    const drafts = toDrafts([
      { effectiveFrom, lat: 1, lon: 2, city: null, region: null, country: 'US' },
    ]);
    expect(drafts[0]?.date).toBe('2024-03-01');
    expect(toEntries(drafts)?.[0]?.effectiveFrom).toBe(effectiveFrom);
  });
});

describe('toEntries', () => {
  it('converts a complete draft and blanks empty text to null', () => {
    const draft = {
      ...emptyDraft(null),
      lat: '41.8781',
      lon: '-87.6298',
      country: 'US',
      city: 'Chicago',
    };
    expect(toEntries([draft])).toEqual([
      {
        effectiveFrom: null,
        lat: 41.8781,
        lon: -87.6298,
        city: 'Chicago',
        region: null,
        country: 'US',
      },
    ]);
  });

  it('is null while coordinates or country are missing or out of range', () => {
    expect(toEntries([{ ...emptyDraft(null), lat: '', lon: '1', country: 'US' }])).toBeNull();
    expect(toEntries([{ ...emptyDraft(null), lat: '91', lon: '1', country: 'US' }])).toBeNull();
    expect(toEntries([{ ...emptyDraft(null), lat: '1', lon: '1', country: '' }])).toBeNull();
  });
});

describe('toDrafts', () => {
  it('round-trips a saved entry and rounds stored float noise', () => {
    const [draft] = toDrafts([
      {
        effectiveFrom: null,
        lat: 41.87810134887695,
        lon: -87.62979888916016,
        city: 'Chicago',
        region: null,
        country: 'US',
      },
    ]);
    expect(draft?.lat).toBe('41.878101');
    expect(draft?.region).toBe('');
  });

  it('keys ignore the draft identity so an untouched list is unchanged', () => {
    const entries = [
      { effectiveFrom: null, lat: 1, lon: 2, city: null, region: null, country: 'US' },
    ];
    expect(draftsKey(toDrafts(entries))).toBe(draftsKey(toDrafts(entries)));
  });
});
