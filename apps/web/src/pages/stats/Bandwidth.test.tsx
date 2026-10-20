import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StatsBandwidth } from './Bandwidth';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Highcharts touches CSS.supports at import time, which jsdom does not implement.
vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts-react-official', () => ({ HighchartsReact: () => null }));

vi.mock('@/hooks/queries', () => ({
  useBandwidthDaily: vi.fn(),
  useBandwidthSummary: vi.fn(),
  usePeople: vi.fn(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

import { useBandwidthDaily, useBandwidthSummary, usePeople } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const mockUseBandwidthDaily = vi.mocked(useBandwidthDaily);
const mockUseBandwidthSummary = vi.mocked(useBandwidthSummary);
const mockUsePeople = vi.mocked(usePeople);
const mockUseServer = vi.mocked(useServer);

const loading = {
  data: undefined,
  isLoading: true,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

describe('StatsBandwidth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServer.mockReturnValue({
      selectedServerIds: ['server-1'],
      selectedServers: [{ id: 'server-1', name: 'Server One', color: '#ff0000' }],
      isMultiServer: false,
    } as unknown as ReturnType<typeof useServer>);
    mockUseBandwidthDaily.mockReturnValue(
      loading as unknown as ReturnType<typeof useBandwidthDaily>
    );
    mockUseBandwidthSummary.mockReturnValue(
      loading as unknown as ReturnType<typeof useBandwidthSummary>
    );
    mockUsePeople.mockReturnValue(loading as unknown as ReturnType<typeof usePeople>);
  });

  it('asks for the top five people by data', () => {
    render(
      <MemoryRouter initialEntries={['/stats/bandwidth?period=week']}>
        <StatsBandwidth />
      </MemoryRouter>
    );

    expect(mockUsePeople).toHaveBeenCalledWith(expect.anything(), ['server-1'], {
      rank: 'data',
      pageSize: 5,
    });
    expect(screen.getByText('statsBandwidth.topPeopleTitle')).toBeInTheDocument();
    expect(screen.getByText('statsBandwidth.topPeopleCaption')).toBeInTheDocument();
  });

  it('links to people ranked by data with the current range', () => {
    render(
      <MemoryRouter initialEntries={['/stats/bandwidth?period=week']}>
        <StatsBandwidth />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /statsUsers.openPeople/ })).toHaveAttribute(
      'href',
      '/stats/people?rank=data&period=week'
    );
  });
});
