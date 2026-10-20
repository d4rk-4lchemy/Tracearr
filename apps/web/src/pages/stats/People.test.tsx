import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { PeopleResponse, PersonRow } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StatsPeople } from './People';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/queries', () => ({
  usePeople: vi.fn(),
  useRequestsConfigured: vi.fn(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

vi.mock('@/hooks/useTimeRange', () => ({
  useTimeRange: vi.fn(),
}));

import { usePeople, useRequestsConfigured } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useTimeRange } from '@/hooks/useTimeRange';

const mockUsePeople = vi.mocked(usePeople);

function mockRequestsConfigured(configured: boolean) {
  vi.mocked(useRequestsConfigured).mockReturnValue({
    data: { configured },
  } as unknown as ReturnType<typeof useRequestsConfigured>);
}

function person(overrides: Partial<PersonRow> & { username: string }): PersonRow {
  return {
    userId: `u-${overrides.username}`,
    serverUserId: `su-${overrides.username}`,
    identityName: null,
    thumbUrl: null,
    serverId: 'server-1',
    trustScore: null,
    plays: 10,
    watchMs: 7_200_000,
    bytes: 2_000_000_000,
    directPlayRate: 90,
    transcodes: 1,
    transcodeShare: 10,
    requests: 0,
    requestsWatched: 0,
    lastPlayAt: '2026-10-10T12:00:00.000Z',
    trend: [1, 2, 3, 4, 5, 6, 7],
    identityServers: [],
    ...overrides,
  };
}

const response: PeopleResponse = {
  data: [
    person({ username: 'alice', plays: 40 }),
    person({ username: 'bob', plays: 30 }),
    person({ username: 'carol', plays: 20 }),
    person({ username: 'dave', plays: 10 }),
  ],
  summary: {
    activePeople: 4,
    totalPeople: 9,
    topThreeShare: 90,
    topTranscoderShare: 50,
    topTranscoderCount: 5,
    totalTranscodes: 10,
    quietPeople: 2,
    quietDays: 90,
  },
  meta: { page: 1, pageSize: 20, total: 4 },
};

function mockPeople(data: PeopleResponse | undefined, overrides: Record<string, unknown> = {}) {
  mockUsePeople.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof usePeople>);
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{`${pathname}${search}`}</p>;
}

function renderPage(path = '/stats/people?period=week') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <StatsPeople />
        <LocationProbe />
      </TooltipProvider>
    </MemoryRouter>
  );
}

function lastOptions() {
  const calls = mockUsePeople.mock.calls;
  return calls[calls.length - 1]?.[2];
}

describe('StatsPeople', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useServer).mockReturnValue({
      selectedServerIds: ['server-1'],
    } as unknown as ReturnType<typeof useServer>);
    vi.mocked(useTimeRange).mockReturnValue({
      value: { period: 'week' },
      apiDayParams: { period: 'week' },
    } as unknown as ReturnType<typeof useTimeRange>);
    mockPeople(response);
    mockRequestsConfigured(true);
  });

  it('renders the four summary cards and the ranked table with no separate top three', () => {
    renderPage();

    expect(screen.getAllByRole('link', { name: /alice/ })).toHaveLength(1);

    for (const label of [
      'statsUsers.summary.active',
      'statsUsers.summary.topThreeShare',
      'statsUsers.summary.transcoderShare',
      'statsUsers.summary.quiet',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const body = screen.getAllByRole('rowgroup')[1]!;
    expect(within(body).getAllByRole('row')).toHaveLength(4);
  });

  it('writes ?rank=data and resets to page 1 when the switch changes, keeping ?period', async () => {
    const user = userEvent.setup();
    renderPage('/stats/people?period=week&page=3');

    await user.click(screen.getByRole('radio', { name: 'common:labels.data' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/stats/people?period=week&rank=data');
    expect(lastOptions()).toMatchObject({ rank: 'data', page: 1 });
  });

  it('offers the requests rank and column when a request service is configured', () => {
    renderPage('/stats/people?rank=requests');

    expect(screen.getByRole('radio', { name: 'statsUsers.rank.requests' })).toBeChecked();
    expect(
      screen.getByRole('columnheader', { name: 'statsUsers.columns.requests' })
    ).toBeInTheDocument();
    expect(lastOptions()).toMatchObject({ rank: 'requests' });
  });

  it('hides the requests rank and column without a request service and ranks ?rank=requests by plays', () => {
    mockRequestsConfigured(false);
    renderPage('/stats/people?rank=requests');

    expect(
      screen.queryByRole('radio', { name: 'statsUsers.rank.requests' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'statsUsers.columns.requests' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'common:labels.plays' })).toBeChecked();
    expect(lastOptions()).toMatchObject({ rank: 'plays' });
  });

  it('falls back to plays for an unknown rank', () => {
    renderPage('/stats/people?rank=bogus');

    expect(lastOptions()).toMatchObject({ rank: 'plays' });
    expect(screen.getByRole('radio', { name: 'common:labels.plays' })).toBeChecked();
  });

  it('sends the search box to the query and goes back to page 1', async () => {
    const user = userEvent.setup();
    renderPage('/stats/people?page=2');

    await user.type(screen.getByPlaceholderText('common:search.searchUsers'), 'ali');

    await waitFor(() => expect(lastOptions()).toMatchObject({ search: 'ali', page: 1 }));
  });

  it('drops a ?page past the last page and asks for page 1', async () => {
    mockPeople({ ...response, meta: { page: 3, pageSize: 20, total: 5 }, data: [] });

    renderPage('/stats/people?period=month&page=3');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/stats/people?period=month')
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=');
    expect(lastOptions()).toMatchObject({ page: 1 });
  });

  it('shows the empty state when no one played in range', () => {
    mockPeople({ ...response, data: [], summary: { ...response.summary, activePeople: 0 } });

    renderPage();

    expect(screen.getByText('statsUsers.noActivity')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('sends a custom range as the UTC days picked, whatever the browser zone', async () => {
    const actual =
      await vi.importActual<typeof import('@/hooks/useTimeRange')>('@/hooks/useTimeRange');
    vi.mocked(useTimeRange).mockImplementation(actual.useTimeRange);
    vi.stubEnv('TZ', 'Pacific/Auckland');

    renderPage('/stats/people?period=custom&from=2026-09-01&to=2026-09-30');

    expect(mockUsePeople).toHaveBeenLastCalledWith(
      {
        period: 'custom',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2026-09-30T00:00:00.000Z',
      },
      ['server-1'],
      expect.anything()
    );
    vi.unstubAllEnvs();
  });
});
