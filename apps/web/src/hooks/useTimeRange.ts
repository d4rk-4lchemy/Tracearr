import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { TimeRangePeriod, TimeRangeValue } from '@/components/ui/time-range-picker';

const DEFAULT_PERIOD: TimeRangePeriod = 'month';

function parseDate(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? undefined : date;
}

function formatDateParam(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
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

  return { value, setValue, apiParams };
}
