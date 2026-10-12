import { describe, it, expect } from 'vitest';
import { formatDelta, periodWindows } from './periodWindows';

const now = new Date('2026-10-09T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('periodWindows', () => {
  it('puts the previous window right before a rolling period', () => {
    const { current, previous } = periodWindows({ period: 'week' }, now);

    expect(current.endDate).toEqual(now);
    expect(current.startDate).toEqual(new Date(now.getTime() - 7 * DAY));
    expect(previous?.endDate).toEqual(current.startDate);
    expect(previous?.startDate).toEqual(new Date(now.getTime() - 14 * DAY));
  });

  it('has no window and no previous for all time', () => {
    expect(periodWindows({ period: 'all' }, now)).toEqual({ current: {}, previous: null });
  });

  it('mirrors a custom range', () => {
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-04T00:00:00.000Z');
    const { previous } = periodWindows({ period: 'custom', startDate, endDate }, now);

    expect(previous).toEqual({
      startDate: new Date('2026-09-28T00:00:00.000Z'),
      endDate: startDate,
    });
  });
});

describe('formatDelta', () => {
  it('signs the change and skips a zero baseline', () => {
    expect(formatDelta(12, 10)).toBe('+20%');
    expect(formatDelta(5, 10)).toBe('-50%');
    expect(formatDelta(5, 0)).toBeNull();
  });
});
