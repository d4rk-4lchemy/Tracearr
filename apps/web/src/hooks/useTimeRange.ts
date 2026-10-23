import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { fromIsoDate, nextLocalDay, safeParseDate, toIsoDate, utcDayStart } from '@/lib/dateFormat';
import type { TimeRangePeriod, TimeRangeValue } from '@/components/ui/time-range-picker';

const DEFAULT_PERIOD: TimeRangePeriod = 'month';

export function toApiPeriod(value: TimeRangeValue): '7d' | '30d' | '1y' | 'all' {
  switch (value.period) {
    case 'week':
      return '7d';
    case 'month':
      return '30d';
    case 'year':
      return '1y';
    case 'all':
      return 'all';
    default:
      return '30d';
  }
}

export interface ApiLibraryParams {
  period: ReturnType<typeof toApiPeriod>;
  startDate?: string;
  endDate?: string;
}

export function toApiLibraryParams(value: TimeRangeValue): ApiLibraryParams {
  const period = toApiPeriod(value);
  if (value.period !== 'custom' || !value.startDate || !value.endDate) return { period };
  return {
    period,
    startDate: utcDayStart(value.startDate),
    endDate: utcDayStart(value.endDate, 1),
  };
}

// For endpoints whose window includes the end day: the first and last picked day, as UTC midnights.
export function toApiDayParams(value: TimeRangeValue): {
  period: TimeRangePeriod;
  startDate?: string;
  endDate?: string;
} {
  if (value.period !== 'custom' || !value.startDate || !value.endDate) {
    return { period: value.period };
  }
  return {
    period: value.period,
    startDate: utcDayStart(value.startDate),
    endDate: utcDayStart(value.endDate),
  };
}

const PRESET_DAYS: Partial<Record<TimeRangePeriod, number>> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export type DateWindow = { startDate: Date; endDate?: Date } | null;

/**
 * The window History queries for a range, from apiParams, so its end is already exclusive. A
 * preset counts back from now and has no end, so a refetch still finds sessions started after
 * the window was computed.
 */
export function resolveWindow(
  period: TimeRangePeriod,
  startDate: string | undefined,
  endDate: string | undefined
): DateWindow {
  if (startDate && endDate) {
    return { startDate: new Date(startDate), endDate: new Date(endDate) };
  }
  if (period === 'all') return null;
  return { startDate: new Date(Date.now() - (PRESET_DAYS[period] ?? 30) * 86_400_000) };
}

export function useTimeRange() {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = useMemo<TimeRangeValue>(() => {
    const period = (searchParams.get('period') as TimeRangePeriod) || DEFAULT_PERIOD;

    if (period === 'custom') {
      const [startDate, endDate] = [searchParams.get('from'), searchParams.get('to')].map(
        (param) => fromIsoDate(param) ?? safeParseDate(param) ?? undefined
      );

      // If custom period but missing dates, fall back to default
      if (!startDate || !endDate) {
        return { period: DEFAULT_PERIOD };
      }

      return { period, startDate, endDate };
    }

    return { period };
  }, [searchParams]);

  const setValue = useCallback(
    (newValue: TimeRangeValue) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);

          params.set('period', newValue.period);

          if (newValue.period === 'custom' && newValue.startDate && newValue.endDate) {
            const from = toIsoDate(newValue.startDate);
            const to = toIsoDate(newValue.endDate);
            if (from && to) {
              params.set('from', from);
              params.set('to', to);
            }
          } else {
            params.delete('from');
            params.delete('to');
          }

          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // The session routes read [startDate, endDate), so the end is the day after the last picked one
  const apiParams = useMemo(() => {
    if (value.period === 'custom' && value.startDate && value.endDate) {
      return {
        period: value.period,
        startDate: value.startDate.toISOString(),
        endDate: nextLocalDay(value.endDate).toISOString(),
      };
    }
    return { period: value.period };
  }, [value]);

  const apiLibraryParams = useMemo(() => toApiLibraryParams(value), [value]);

  const apiDayParams = useMemo(() => toApiDayParams(value), [value]);

  return { value, setValue, apiParams, apiLibraryParams, apiDayParams };
}
