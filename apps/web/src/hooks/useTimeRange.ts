import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
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

// The library aggregates are UTC-day rows, so a picked calendar day goes to the server as
// that day's UTC midnight whatever zone the browser is in.
export function utcDayStart(date: Date, plusDays = 0): string {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + plusDays)
  ).toISOString();
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

const DAY_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  const day = DAY_PARAM.exec(dateStr);
  const date = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(dateStr);
  return isNaN(date.getTime()) ? undefined : date;
}

function formatDateParam(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function useTimeRange() {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = useMemo<TimeRangeValue>(() => {
    const period = (searchParams.get('period') as TimeRangePeriod) || DEFAULT_PERIOD;

    if (period === 'custom') {
      const startDate = parseDate(searchParams.get('from'));
      const endDate = parseDate(searchParams.get('to'));

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
            const from = formatDateParam(newValue.startDate);
            const to = formatDateParam(newValue.endDate);
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

  // Helper to get API params for backend calls
  const apiParams = useMemo(() => {
    if (value.period === 'custom' && value.startDate && value.endDate) {
      return {
        period: value.period,
        startDate: value.startDate.toISOString(),
        endDate: value.endDate.toISOString(),
      };
    }
    return { period: value.period };
  }, [value]);

  const apiLibraryParams = useMemo(() => toApiLibraryParams(value), [value]);

  const apiDayParams = useMemo(() => toApiDayParams(value), [value]);

  return { value, setValue, apiParams, apiLibraryParams, apiDayParams };
}
