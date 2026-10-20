import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StatsActivity } from './Activity';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { playsChart } = vi.hoisted(() => ({ playsChart: vi.fn((_props: unknown) => null) }));
vi.mock('@/components/charts', () => ({
  PlaysChart: playsChart,
  PlatformChart: () => null,
  DayOfWeekChart: () => null,
  HourOfDayChart: () => null,
  QualityChart: () => null,
  ConcurrentChart: () => null,
  EngagementBreakdownChart: () => null,
  PlaysVsSessionsChart: () => null,
}));

vi.mock('@/hooks/queries', () => ({
  usePlaysStats: vi.fn(),
  usePlaysByDayOfWeek: vi.fn(),
  usePlaysByHourOfDay: vi.fn(),
  usePlatformStats: vi.fn(),
  useQualityStats: vi.fn(),
  useConcurrentStats: vi.fn(),
  useEngagementStats: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }));
vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({
    selectedServerIds: ['srv-1', 'srv-2'],
    selectedServers: [
      { id: 'srv-1', name: 'Den', color: null },
      { id: 'srv-2', name: 'Loft', color: null },
    ],
    isMultiServer: true,
  }),
}));

import * as queries from '@/hooks/queries';

const idle = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };

describe('StatsActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const hook of Object.values(queries)) {
      vi.mocked(hook as () => unknown).mockReturnValue(idle);
    }
  });

  it('asks for plays split by media type and stacks the plays chart by it', () => {
    render(
      <MemoryRouter initialEntries={['/stats/activity?period=week']}>
        <StatsActivity />
      </MemoryRouter>
    );

    const serverIds = ['srv-1', 'srv-2'];
    expect(queries.usePlaysStats).toHaveBeenCalledWith(expect.anything(), serverIds, {
      groupBy: 'mediaType',
    });
    for (const hook of [queries.usePlaysByDayOfWeek, queries.usePlaysByHourOfDay]) {
      expect(hook).toHaveBeenCalledWith(expect.anything(), serverIds, { groupBy: 'mediaType' });
    }
    expect(playsChart.mock.calls[0]?.[0]).toMatchObject({ stackBy: 'mediaType' });
    expect(playsChart.mock.calls[0]?.[0]).not.toHaveProperty('isMultiServer');
  });
});
