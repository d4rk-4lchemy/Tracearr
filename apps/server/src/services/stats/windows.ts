/**
 * Window helpers shared by the range stats services: bounds on user_media_plays_daily's UTC day
 * buckets, the finished test, the trend buckets and the zero-filled series a chart reads.
 */

import { sql, type SQL } from 'drizzle-orm';
import { TIME_MS, type RangeSeriesPoint } from '@tracearr/shared';
import {
  getLocalDateTimeParts,
  type DateRange,
  type StatsPeriod,
} from '../../routes/stats/utils.js';

export const TREND_BUCKETS = 7;
export const TREND_BUCKETS_SQL = sql.raw(String(TREND_BUCKETS));

export const FINISHED_SQL = sql.raw(
  'COALESCE(max_progress_ms, 0) >= content_duration_ms * 0.85 OR watched_ms >= content_duration_ms * 0.85'
);

// Wall-clock bucket widths for getBucketInterval's intervals; time_bucket's default origin
// is Monday 2000-01-03, which only shifts the weekly buckets.
const BUCKET_MS: Record<string, number | undefined> = {
  '1 hour': TIME_MS.HOUR,
  '6 hours': 6 * TIME_MS.HOUR,
  '1 day': TIME_MS.DAY,
  '1 week': TIME_MS.WEEK,
};
const BUCKET_ORIGIN_MS = Date.UTC(2000, 0, 3);

export function startOfUtcDay(date: Date): number {
  return new Date(date).setUTCHours(0, 0, 0, 0);
}

/**
 * Whole UTC days, so the plays aggregate's day buckets and the sessions reads cover the same
 * span. The end day is included. A custom range keeps its first day; a preset keeps its length
 * in days, ending today.
 */
export function alignToUtcDays(period: StatsPeriod, range: DateRange): DateRange {
  const end = startOfUtcDay(range.end) + TIME_MS.DAY;
  if (!range.start) return { start: null, end: new Date(end) };
  const start =
    period === 'custom'
      ? startOfUtcDay(range.start)
      : end -
        Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / TIME_MS.DAY)) *
          TIME_MS.DAY;
  return { start: new Date(start), end: new Date(end) };
}

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((1000 * part) / whole) / 10 : null;
}

export function toIso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Bounds on user_media_plays_daily's UTC day buckets; the window is already day-aligned. */
export function dailyBoundsSql(alias: string, start: Date | null, end: Date): SQL {
  const day = sql.raw(`${alias}.day`);
  const lower = start ? sql`AND ${day} >= ${start}::timestamptz` : sql``;
  return sql`${lower} AND ${day} < ${end}::timestamptz`;
}

/**
 * The 1-based trend bucket of a `chains` row's first_day, in TREND_BUCKETS equal slices of the
 * range. An all-time range starts at the earliest chain.
 */
export function trendBucketSql(range: DateRange): SQL {
  const hi = sql`extract(epoch from ${range.end}::timestamptz)`;
  const lo = range.start
    ? sql`extract(epoch from ${range.start}::timestamptz)`
    : sql`(SELECT LEAST(extract(epoch from MIN(first_day)), ${hi} - 1) FROM chains)`;
  return sql`LEAST(${TREND_BUCKETS_SQL}, GREATEST(1, width_bucket(extract(epoch from first_day), ${lo}, ${hi}, ${TREND_BUCKETS_SQL})))`;
}

// setUTCFullYear, not Date.UTC, which maps years 0-99 to 1900-1999.
function wallClockMs(date: Date, timezone: string): number {
  const p = getLocalDateTimeParts(timezone, date);
  const wall = new Date(0);
  wall.setUTCFullYear(p.year, p.month - 1, p.day);
  return wall.setUTCHours(p.hour, p.minute, p.second, 0);
}

/** The time_bucket labels queryPlaysOverTime emits for [start, end), as `YYYY-MM-DD HH:MM:SS`. */
export function bucketLabels(
  start: Date,
  end: Date,
  interval: string,
  timezone: string
): string[] | null {
  const step = BUCKET_MS[interval];
  if (!step) return null;
  const startWall = wallClockMs(start, timezone);
  const endWall = wallClockMs(end, timezone);
  const labels: string[] = [];
  let at = BUCKET_ORIGIN_MS + Math.floor((startWall - BUCKET_ORIGIN_MS) / step) * step;
  for (; at < endWall; at += step) {
    labels.push(new Date(at).toISOString().slice(0, 19).replace('T', ' '));
  }
  return labels;
}

/** Sums the per-server rows by bucket and fills every empty bucket of a bounded window. */
export function toSeries(
  rows: { date: string; count: number | string }[],
  labels: string[] | null
): RangeSeriesPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.date, (counts.get(row.date) ?? 0) + Number(row.count));
  const dates = labels ?? [...counts.keys()].sort();
  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}
