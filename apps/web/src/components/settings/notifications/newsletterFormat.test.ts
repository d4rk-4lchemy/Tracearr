import { describe, it, expect, afterEach } from 'vitest';
import { countsLine, outcomeVariant, scheduleSummary } from './newsletterFormat';

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe('scheduleSummary', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('names the weekday in the formatting locale and the time in the app clock', () => {
    localStorage.setItem('tracearr_time_format', '24h');
    expect(
      scheduleSummary({ kind: 'weekly', dayOfWeek: 1, time: '09:05' }, 'Europe/Berlin', t)
    ).toBe(
      'newsletters.schedule.inZone:{"summary":"newsletters.schedule.weekly:{\\"day\\":\\"Monday\\",\\"time\\":\\"09:05\\"}","timezone":"Europe/Berlin"}'
    );
    expect(scheduleSummary({ kind: 'daily', time: '18:00' }, 'UTC', t)).toContain(
      'newsletters.schedule.daily:{\\"time\\":\\"18:00\\"}'
    );
    expect(scheduleSummary({ kind: 'monthly', dayOfMonth: 3, time: '07:30' }, 'UTC', t)).toContain(
      'newsletters.schedule.monthly:{\\"day\\":3,\\"time\\":\\"07:30\\"}'
    );
    expect(scheduleSummary({ kind: 'cron', expression: '0 8 * * 1-5' }, 'UTC', t)).toContain(
      'newsletters.schedule.cron:{\\"expression\\":\\"0 8 * * 1-5\\"}'
    );
  });
});

describe('outcomeVariant and countsLine', () => {
  it('maps outcomes to badge tones', () => {
    expect(outcomeVariant('sent')).toBe('success');
    expect(outcomeVariant('partial')).toBe('warning');
    expect(outcomeVariant('failed')).toBe('danger');
    expect(outcomeVariant('skipped_empty')).toBe('outline');
    expect(outcomeVariant('rendering')).toBe('secondary');
    expect(outcomeVariant('sending')).toBe('secondary');
  });

  it('joins the three section counts', () => {
    expect(countsLine({ movies: 12, shows: 3, episodes: 40, albums: 0, mostWatched: 0 }, t)).toBe(
      'newsletters.counts.movies:{"count":12}, newsletters.counts.shows:{"count":3}, newsletters.counts.albums:{"count":0}'
    );
    expect(countsLine({}, t)).toBe(
      'newsletters.counts.movies:{"count":0}, newsletters.counts.shows:{"count":0}, newsletters.counts.albums:{"count":0}'
    );
  });
});
