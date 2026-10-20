import type Highcharts from 'highcharts';
import type { PlaysMediaGroup, Server } from '@tracearr/shared';

/**
 * Parse a date string to timestamp for Highcharts datetime axis.
 * Handles ISO dates ("YYYY-MM-DD") and PostgreSQL timestamps ("YYYY-MM-DD HH:mm:ss+TZ").
 */
export function parseChartDate(dateStr: string): number {
  if (dateStr.includes(' ')) {
    // PostgreSQL timestamp: "2026-01-28 05:00:00+00" -> "2026-01-28T05:00:00+00:00"
    const normalized = dateStr.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
    return new Date(normalized).getTime();
  }
  // Date-only: "2026-01-28" -> local midnight
  return new Date(dateStr + 'T00:00:00').getTime();
}

/**
 * Build one Highcharts series per server in stable server order.
 * Rows not matching any server in `servers` are silently dropped.
 */
export function buildPerServerSeries<T extends { serverId: string }>(
  rows: T[],
  servers: Pick<Server, 'id' | 'name' | 'color'>[],
  getPoint: (row: T) => [number, number],
  opts?: { type?: 'area' | 'column'; stacking?: 'normal' }
): Highcharts.SeriesOptionsType[] {
  const type = opts?.type ?? 'area';
  const stacking = opts?.stacking ?? 'normal';

  return servers.map((server) => {
    const serverRows = rows
      .filter((r) => r.serverId === server.id)
      .map(getPoint)
      .sort((a, b) => a[0] - b[0]);

    return {
      type,
      name: server.name,
      color: server.color ?? undefined,
      stacking,
      data: serverRows,
    };
  });
}

// chart-1 and chart-2 are both the accent hue and chart-3 sits beside the default accent, so the
// three groups take the palette's three distinct hues: accent, amber and red.
const MEDIA_GROUP_SERIES = [
  { group: 'movie', labelKey: 'common:media.movie_plural', color: 'hsl(var(--chart-2))' },
  { group: 'show', labelKey: 'common:media.tvShows', color: 'hsl(var(--chart-4))' },
  { group: 'live', labelKey: 'common:media.liveTV', color: 'hsl(var(--chart-3))' },
  { group: 'music', labelKey: 'common:media.music', color: 'hsl(var(--chart-5))' },
] as const satisfies readonly { group: PlaysMediaGroup; labelKey: string; color: string }[];

export interface MediaGroupSeries {
  labelKey: (typeof MEDIA_GROUP_SERIES)[number]['labelKey'];
  color: string;
  data: [number, number][];
}

/**
 * One series per media group in movie, show, music order, summed across servers at each x and
 * zero-filled over every x the rows carry. A group with no plays at any x is left out.
 */
export function buildMediaGroupSeries<T extends { mediaType?: PlaysMediaGroup; count: number }>(
  rows: T[],
  getX: (row: T) => number
): MediaGroupSeries[] {
  const xs = [...new Set(rows.map(getX))].sort((a, b) => a - b);
  return MEDIA_GROUP_SERIES.flatMap(({ group, labelKey, color }) => {
    const sums = new Map<number, number>();
    for (const row of rows) {
      if (row.mediaType !== group) continue;
      const x = getX(row);
      sums.set(x, (sums.get(x) ?? 0) + row.count);
    }
    if (![...sums.values()].some((count) => count > 0)) return [];
    return [{ labelKey, color, data: xs.map((x): [number, number] => [x, sums.get(x) ?? 0]) }];
  });
}

/** Shared-tooltip body: one colored line per series. */
export function sharedTooltipRows(points: Highcharts.Point[]): string {
  return points
    .map((p) => `<span style="color:${p.color}">●</span> ${p.series.name}: <b>${p.y}</b>`)
    .join('<br/>');
}

/** Shared-tooltip body for stacked series, closed by the stack total. */
export function stackedTooltipRows(points: Highcharts.Point[], totalLabel: string): string {
  const total = points.find((p) => p.total !== undefined)?.total ?? 0;
  return `${sharedTooltipRows(points)}<br/>${totalLabel}: <b>${total}</b>`;
}
