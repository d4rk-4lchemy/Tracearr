import type { HourOfDayStats } from '@tracearr/shared';
import { formatHourOfDay } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';

interface HourStripProps {
  data: HourOfDayStats[];
  peakHour: number | null;
  /** Caption for the outlined peak, already translated. */
  peakLabel?: string;
  /** Caption for the peak to read this one against, such as the server's. */
  comparePeakLabel?: string;
  label: string;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The busiest hour, or null when nothing was played. */
export function peakHourOf(data: HourOfDayStats[]): number | null {
  let peak: HourOfDayStats | null = null;
  for (const row of data) {
    if (row.count > 0 && (peak === null || row.count > peak.count)) peak = row;
  }
  return peak?.hour ?? null;
}

/** Plays per hour of day as 24 cells whose opacity follows the count. */
export function HourStrip({ data, peakHour, peakLabel, comparePeakLabel, label }: HourStripProps) {
  const counts = new Map(data.map((row) => [row.hour, row.count]));
  const max = Math.max(0, ...counts.values());
  const caption = [peakLabel, comparePeakLabel].filter(Boolean).join(' · ');

  return (
    <div className="space-y-1.5">
      <ul aria-label={label} className="grid grid-cols-24 gap-0.5">
        {HOURS.map((hour) => {
          const count = counts.get(hour) ?? 0;
          const isPeak = hour === peakHour;
          return (
            <li
              key={hour}
              data-hour={hour}
              data-peak={isPeak || undefined}
              title={`${formatHourOfDay(hour)}: ${count}`}
              className={cn('bg-muted relative h-6 rounded-sm', isPeak && 'ring-foreground ring-1')}
            >
              <span className="sr-only">{`${formatHourOfDay(hour)}: ${count}`}</span>
              <div
                className="bg-primary absolute inset-0 rounded-sm"
                style={{ opacity: max > 0 ? count / max : 0 }}
              />
            </li>
          );
        })}
      </ul>
      {caption !== '' && <p className="text-muted-foreground text-xs">{caption}</p>}
    </div>
  );
}
