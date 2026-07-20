function parseUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDispatcharrCatchupClock(value: string | null | undefined): string {
  const parsedMs = parseUtcMs(value);
  if (parsedMs === null) return '--:--';

  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(parsedMs));
}
