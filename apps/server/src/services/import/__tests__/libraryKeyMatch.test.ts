import { describe, expect, it } from 'vitest';
import { libraryKeyProvablyReused } from '../libraryKeyMatch.js';

const item = { mediaType: 'movie', title: 'Harbor Gone', year: 2001 };

describe('libraryKeyProvablyReused', () => {
  it('keeps a key match whose title or year still agrees within the resolver tolerance', () => {
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'movie', title: 'Harbour Gone', year: 2001 })
    ).toBe(false);
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'movie', title: 'HARBOR GONE!', year: 1800 })
    ).toBe(false);
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'movie', title: 'Other Film', year: 2002 })
    ).toBe(false);
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'unknown', title: 'Other Film', year: null })
    ).toBe(false);
    expect(
      libraryKeyProvablyReused(
        { ...item, year: null },
        { mediaType: 'movie', title: 'Other Film', year: 1990 }
      )
    ).toBe(false);
  });

  it('refuses a key held by another media type, or by a title and year that both disagree', () => {
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'episode', title: 'Harbor Gone', year: 2001 })
    ).toBe(true);
    expect(
      libraryKeyProvablyReused(item, { mediaType: 'movie', title: 'Other Film', year: 1990 })
    ).toBe(true);
  });
});
