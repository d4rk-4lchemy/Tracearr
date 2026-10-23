import { formatDate } from '@/lib/dateFormat';

function parseUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDispatcharrCatchupClock(value: string | null | undefined): string {
  const parsedMs = parseUtcMs(value);
  if (parsedMs === null) return '--:--';

  return formatDate(new Date(parsedMs), { hour: 'numeric', minute: '2-digit' });
}
