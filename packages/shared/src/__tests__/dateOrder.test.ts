import { describe, expect, it } from 'vitest';
import {
  genreDetailQuerySchema,
  genresQuerySchema,
  libraryGrowthQuerySchema,
  peopleQuerySchema,
  statsQuerySchema,
  userRangeStatsQuerySchema,
} from '../schemas.js';

const SAME_DAY = {
  period: 'custom',
  startDate: '2026-09-15T00:00:00.000Z',
  endDate: '2026-09-15T00:00:00.000Z',
};

describe('date order on day-inclusive endpoints', () => {
  it('accepts a single-day custom range on genres and growth', () => {
    expect(genresQuerySchema.safeParse(SAME_DAY).success).toBe(true);
    expect(genreDetailQuerySchema.safeParse(SAME_DAY).success).toBe(true);
    expect(
      libraryGrowthQuerySchema.safeParse({
        startDate: SAME_DAY.startDate,
        endDate: SAME_DAY.endDate,
      }).success
    ).toBe(true);
  });

  it('still rejects an end before the start on genres and growth', () => {
    const reversed = { ...SAME_DAY, startDate: '2026-09-16T00:00:00.000Z' };
    expect(genresQuerySchema.safeParse(reversed).success).toBe(false);
    expect(
      libraryGrowthQuerySchema.safeParse({
        startDate: reversed.startDate,
        endDate: reversed.endDate,
      }).success
    ).toBe(false);
  });

  it('keeps genres requiring both dates for a custom period', () => {
    expect(genresQuerySchema.safeParse({ period: 'custom' }).success).toBe(false);
  });

  it('accepts a single-day custom range on people and user range stats', () => {
    expect(peopleQuerySchema.safeParse(SAME_DAY).success).toBe(true);
    expect(userRangeStatsQuerySchema.safeParse(SAME_DAY).success).toBe(true);
    const reversed = { ...SAME_DAY, startDate: '2026-09-16T00:00:00.000Z' };
    expect(peopleQuerySchema.safeParse(reversed).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ period: 'custom' }).success).toBe(false);
  });

  it('keeps the strict order on statsQuerySchema', () => {
    expect(statsQuerySchema.safeParse(SAME_DAY).success).toBe(false);
  });
});
