import { format } from 'date-fns';
import { getTimeFormatString } from '@/lib/timeFormat';

function parseUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDispatcharrCatchupClock(value: string | null | undefined): string {
  const parsedMs = parseUtcMs(value);
  if (parsedMs === null) return '--:--';

  return format(new Date(parsedMs), getTimeFormatString());
}
