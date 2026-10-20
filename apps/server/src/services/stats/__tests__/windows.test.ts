import { describe, expect, it } from 'vitest';
import { bucketLabels } from '../windows.js';

describe('bucketLabels', () => {
  it('labels each day of a three-day daily window', () => {
    expect(
      bucketLabels(
        new Date('2026-10-15T00:00:00Z'),
        new Date('2026-10-18T00:00:00Z'),
        '1 day',
        'UTC'
      )
    ).toEqual(['2026-10-15 00:00:00', '2026-10-16 00:00:00', '2026-10-17 00:00:00']);
  });
});
