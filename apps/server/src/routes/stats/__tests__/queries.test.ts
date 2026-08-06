/**
 * Activity query tests.
 *
 * These queries intentionally share one media-type boundary: VOD plus Live TV,
 * regardless of which media server produced the session.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { renderSql } from '../../../test/helpers.js';

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../../../db/client.js';
import {
  queryConcurrentStreams,
  queryPlatforms,
  queryPlaysByDayOfWeek,
  queryPlaysByHourOfDay,
  queryPlaysOverTime,
  queryQualityBreakdown,
} from '../queries.js';

const rangeStart = new Date('2024-06-01T00:00:00Z');
const rangeEnd = new Date('2024-06-08T00:00:00Z');
const emptyServerFilter = sql``;

function assertActivityMediaFilter(callIndex = 0): void {
  const { sql: query } = renderSql(vi.mocked(db.execute).mock.calls[callIndex]![0] as SQL);
  expect(query).toContain("media_type IN ('movie', 'episode', 'live')");
  expect(query).not.toMatch(/media_type IN \([^)]*\b(track|photo|trailer|unknown)\b/);
}

describe('Activity stats queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
  });

  it.each([
    [
      'plays over time',
      () =>
        queryPlaysOverTime({
          rangeStart,
          timezone: 'UTC',
          bucketInterval: '1 day',
          serverFilter: emptyServerFilter,
        }),
    ],
    [
      'day of week',
      () => queryPlaysByDayOfWeek({ rangeStart, timezone: 'UTC', serverFilter: emptyServerFilter }),
    ],
    [
      'hour of day',
      () => queryPlaysByHourOfDay({ rangeStart, timezone: 'UTC', serverFilter: emptyServerFilter }),
    ],
    [
      'concurrent streams',
      () =>
        queryConcurrentStreams({
          rangeStart,
          rangeEnd,
          bucketInterval: '1 day',
          serverFilter: emptyServerFilter,
        }),
    ],
    ['platforms', () => queryPlatforms({ rangeStart, serverFilter: emptyServerFilter })],
    ['stream quality', () => queryQualityBreakdown({ rangeStart, serverFilter: emptyServerFilter })],
  ])('uses the Activity media set for %s', async (_name, runQuery) => {
    await runQuery();
    assertActivityMediaFilter();
  });

  it('keeps the plays deduplication and engagement threshold', async () => {
    await queryPlaysOverTime({
      rangeStart,
      timezone: 'UTC',
      bucketInterval: '1 day',
      serverFilter: emptyServerFilter,
    });

    const { sql: query } = renderSql(vi.mocked(db.execute).mock.calls[0]![0] as SQL);
    expect(query).toContain('duration_ms >=');
    expect(query).toContain('COUNT(DISTINCT COALESCE(reference_id, id))');
  });
});
