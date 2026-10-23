import type { NewsletterSchedule, NewsletterSendOutcome } from '@tracearr/shared';
import { formatClock, weekdayName } from '@/lib/dateFormat';

/** i18next's TFunction can't statically verify the dynamically built keys here; callers pass their real `t` through this shape. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

export type OutcomeVariant = 'success' | 'warning' | 'danger' | 'secondary' | 'outline';

export function outcomeVariant(outcome: NewsletterSendOutcome): OutcomeVariant {
  switch (outcome) {
    case 'sent':
      return 'success';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'skipped_empty':
      return 'outline';
    case 'rendering':
    case 'sending':
      return 'secondary';
  }
}

export function scheduleSummary(
  schedule: NewsletterSchedule,
  timezone: string,
  t: Translate
): string {
  let summary: string;
  switch (schedule.kind) {
    case 'daily':
      summary = t('newsletters.schedule.daily', { time: formatClock(schedule.time) });
      break;
    case 'weekly':
      summary = t('newsletters.schedule.weekly', {
        day: weekdayName(schedule.dayOfWeek, 'long'),
        time: formatClock(schedule.time),
      });
      break;
    case 'monthly':
      summary = t('newsletters.schedule.monthly', {
        day: schedule.dayOfMonth,
        time: formatClock(schedule.time),
      });
      break;
    case 'cron':
      summary = t('newsletters.schedule.cron', { expression: schedule.expression });
      break;
  }
  return t('newsletters.schedule.inZone', { summary, timezone });
}

export function countsLine(itemCounts: Record<string, number>, t: Translate): string {
  return (['movies', 'shows', 'albums'] as const)
    .map((section) => t(`newsletters.counts.${section}`, { count: itemCounts[section] ?? 0 }))
    .join(', ');
}
