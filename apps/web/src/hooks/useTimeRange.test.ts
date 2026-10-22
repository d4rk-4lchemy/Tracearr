import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { resolveWindow, useTimeRange } from './useTimeRange';

function setup(url: string) {
  return renderHook(() => useTimeRange(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [url] }, children),
  }).result.current;
}

describe('useTimeRange apiLibraryParams', () => {
  it('gives a preset as its period token with no dates', () => {
    expect(setup('/library/quality?period=week').apiLibraryParams).toEqual({ period: '7d' });
    expect(setup('/library/quality?period=all').apiLibraryParams).toEqual({ period: 'all' });
    expect(setup('/library/quality').apiLibraryParams).toEqual({ period: '30d' });
  });

  it('gives a custom range as the UTC days the picker selected', () => {
    const { apiLibraryParams } = setup(
      '/library/quality?period=custom&from=2026-03-02&to=2026-03-05'
    );

    expect(apiLibraryParams).toEqual({
      period: '30d',
      startDate: '2026-03-02T00:00:00.000Z',
      endDate: '2026-03-06T00:00:00.000Z',
    });
  });

  it('gives apiDayParams a preset as its period alone', () => {
    expect(setup('/library/genres?period=week').apiDayParams).toEqual({ period: 'week' });
  });

  it('gives a preset window no end so later sessions still match', () => {
    expect(resolveWindow('week', undefined, undefined)).toEqual({ startDate: expect.any(Date) });
  });

  it('falls back to the default period when a custom range is missing a date', () => {
    expect(setup('/library/quality?period=custom&from=2026-03-02').apiLibraryParams).toEqual({
      period: '30d',
    });
  });
});

describe.each(['America/New_York', 'Pacific/Auckland'])('useTimeRange days in %s', (zone) => {
  beforeEach(() => {
    vi.stubEnv('TZ', zone);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads from and to as the calendar days they name', () => {
    const { value } = setup('/library/quality?period=custom&from=2026-09-01&to=2026-09-30');

    expect([
      value.startDate?.getFullYear(),
      value.startDate?.getMonth(),
      value.startDate?.getDate(),
    ]).toEqual([2026, 8, 1]);
    expect([
      value.endDate?.getFullYear(),
      value.endDate?.getMonth(),
      value.endDate?.getDate(),
    ]).toEqual([2026, 8, 30]);
  });

  it('sends a custom range as the UTC midnights of the picked days, end exclusive', () => {
    const { apiLibraryParams } = setup(
      '/library/quality?period=custom&from=2026-09-01&to=2026-09-30'
    );

    expect(apiLibraryParams).toEqual({
      period: '30d',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-10-01T00:00:00.000Z',
    });
  });

  it('sends apiDayParams as the UTC midnights of the first and last picked day', () => {
    const { apiDayParams } = setup('/library/quality?period=custom&from=2026-09-01&to=2026-09-30');

    expect(apiDayParams).toEqual({
      period: 'custom',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
    });
  });

  it('sends the session routes an exclusive end: the day after the last picked day', () => {
    const { apiParams } = setup('/stats/activity?period=custom&from=2026-09-01&to=2026-09-30');

    expect(apiParams).toEqual({
      period: 'custom',
      startDate: new Date(2026, 8, 1).toISOString(),
      endDate: new Date(2026, 9, 1).toISOString(),
    });
  });

  it('ends a custom window where the day after the last picked day starts', () => {
    const { apiParams } = setup('/history?period=custom&from=2026-09-01&to=2026-09-30');

    expect(resolveWindow('custom', apiParams.startDate, apiParams.endDate)).toEqual({
      startDate: new Date(2026, 8, 1),
      endDate: new Date(2026, 9, 1),
    });
  });

  it('writes the day the picker chose, not the UTC day of its midnight', () => {
    const { result } = renderHook(() => ({ range: useTimeRange(), location: useLocation() }), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: ['/library/quality'] }, children),
    });

    act(() =>
      result.current.range.setValue({
        period: 'custom',
        startDate: new Date(2026, 8, 1),
        endDate: new Date(2026, 8, 30, 0, 30),
      })
    );

    expect(result.current.location.search).toBe('?period=custom&from=2026-09-01&to=2026-09-30');
    expect(result.current.range.value.startDate).toEqual(new Date(2026, 8, 1));
  });
});
