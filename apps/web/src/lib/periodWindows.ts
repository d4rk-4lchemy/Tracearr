import type { TimeRangeValue } from '@/components/ui/time-range-picker';

export interface DateWindow {
  startDate?: Date;
  endDate?: Date;
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The picked period as a date window, plus the equally long window right before it. "All" has no previous. */
export function periodWindows(
  value: TimeRangeValue,
  now: Date
): { current: DateWindow; previous: DateWindow | null } {
  if (value.period === 'custom' && value.startDate && value.endDate) {
    const span = value.endDate.getTime() - value.startDate.getTime();
    return {
      current: { startDate: value.startDate, endDate: value.endDate },
      previous: {
        startDate: new Date(value.startDate.getTime() - span),
        endDate: value.startDate,
      },
    };
  }
  if (value.period === 'all' || value.period === 'custom') return { current: {}, previous: null };

  const span = PERIOD_DAYS[value.period] * DAY_MS;
  const start = new Date(now.getTime() - span);
  return {
    current: { startDate: start, endDate: now },
    previous: { startDate: new Date(start.getTime() - span), endDate: start },
  };
}

/** Percent change, or null when there is no baseline to compare against. */
export function deltaPercent(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Percent change as a signed string, or null when there is no baseline to compare against. */
export function formatDelta(current: number, previous: number | null): string | null {
  const pct = deltaPercent(current, previous);
  if (pct === null) return null;
  const rounded = Math.round(pct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
