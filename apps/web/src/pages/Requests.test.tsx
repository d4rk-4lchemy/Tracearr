import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type {
  RequesterFollowThrough,
  RequestOutcomeRow,
  RequestsAnalyticsResponse,
} from '@tracearr/shared';
import { Requests } from './Requests';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/hooks/queries', () => ({
  useRequestsConfigured: vi.fn(),
  useRequestsAnalytics: vi.fn(),
  useRequestsUnplayed: vi.fn(),
  useRequesters: vi.fn(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

// Stub the funnel: the charts barrel drags in every Highcharts module.
vi.mock('@/components/charts', () => ({
  RequestFunnelChart: ({ stages }: { stages: { name: string; value: number }[] }) => (
    <ol data-testid="request-funnel">
      {stages.map((stage) => (
        <li key={stage.name}>{`${stage.name} ${stage.value}`}</li>
      ))}
    </ol>
  ),
}));

import {
  useRequesters,
  useRequestsAnalytics,
  useRequestsConfigured,
  useRequestsUnplayed,
} from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const mockUseRequestsConfigured = vi.mocked(useRequestsConfigured);
const mockUseRequestsAnalytics = vi.mocked(useRequestsAnalytics);
const mockUseRequestsUnplayed = vi.mocked(useRequestsUnplayed);
const mockUseRequesters = vi.mocked(useRequesters);
const mockUseServer = vi.mocked(useServer);

const analytics: RequestsAnalyticsResponse = {
  funnel: { requested: 12, landed: 8, watched: 6 },
  unplayed: { count: 3, bytes: 0 },
  requesterCount: 4,
};

const outcomeRow: RequestOutcomeRow = {
  id: 'req-1',
  mediaId: 'media-1',
  mediaType: 'movie',
  title: 'Dune',
  year: 2021,
  requestedAt: '2026-01-08T12:00:00.000Z',
  availableAt: '2026-01-09T12:00:00.000Z',
  waitMs: 86_400_000,
  seasons: null,
  fileSizeBytes: 0,
  requester: {
    serverUserId: 'su-1',
    userId: 'u-1',
    serverId: 'srv-1',
    username: 'alice',
    identityName: 'Alice',
    thumb: null,
  },
};

const requesterRow: RequesterFollowThrough = {
  requester: {
    serverUserId: 'su-2',
    userId: 'u-2',
    serverId: 'srv-1',
    username: 'bob',
    identityName: 'Bob',
    thumb: null,
  },
  requested: 5,
  landed: 4,
  watched: 2,
  watchedByOthers: 1,
  medianWaitMs: null,
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as never;
}

function failedQuery(message: string, overrides: Record<string, unknown> = {}) {
  return query({ isSuccess: false, isError: true, error: new Error(message), ...overrides });
}

function serverScope(selectedServerIds: string[]) {
  return { selectedServerIds } as unknown as ReturnType<typeof useServer>;
}

function mockLists(total: number) {
  mockUseRequestsUnplayed.mockReturnValue(query({ data: { data: [outcomeRow], total } }));
  mockUseRequesters.mockReturnValue(query({ data: { data: [requesterRow], total } }));
}

function lastCall(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls[mock.mock.calls.length - 1];
}

function page() {
  return (
    <MemoryRouter>
      <Requests />
    </MemoryRouter>
  );
}

describe('Requests page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServer.mockReturnValue(serverScope(['srv-1', 'srv-2']));
    mockUseRequestsConfigured.mockReturnValue(query({ data: { configured: true } }));
    mockUseRequestsAnalytics.mockReturnValue(query({ data: analytics }));
    mockLists(1);
  });

  it('points to the Seerr connection settings and keeps the data queries off when nothing is linked', () => {
    mockUseRequestsConfigured.mockReturnValue(query({ data: { configured: false } }));

    render(page());

    expect(screen.getByText('requests.page.notConfigured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'requests.page.linkSeerr' })).toHaveAttribute(
      'href',
      '/settings/servers/connections'
    );
    expect(mockUseRequestsAnalytics).toHaveBeenCalledWith(['srv-1', 'srv-2'], { enabled: false });
    expect(mockUseRequestsUnplayed).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
      page: 1,
      pageSize: 20,
      enabled: false,
      sortBy: 'fileSizeBytes',
      sortOrder: 'desc',
    });
    expect(mockUseRequesters).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
      page: 1,
      pageSize: 20,
      enabled: false,
      sortBy: 'watched',
      sortOrder: 'desc',
    });
  });

  it('shows the error state instead of an all-zero page when the status call fails, and retry refetches the status', async () => {
    const refetchStatus = vi.fn();
    const refetchAnalytics = vi.fn();
    mockUseRequestsConfigured.mockReturnValue(
      failedQuery('status failed', { refetch: refetchStatus })
    );
    mockUseRequestsAnalytics.mockReturnValue(query({ refetch: refetchAnalytics }));

    render(page());

    expect(screen.getByText('requests.page.failedToLoad')).toBeInTheDocument();
    expect(screen.getByText('status failed')).toBeInTheDocument();
    expect(screen.queryByText('requests.page.kpi.requested')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetchStatus).toHaveBeenCalledTimes(1);
    expect(refetchAnalytics).not.toHaveBeenCalled();
  });

  it('shows the error state with the analytics message when the analytics call fails', () => {
    mockUseRequestsAnalytics.mockReturnValue(failedQuery('analytics failed'));

    render(page());

    expect(screen.getByText('requests.page.failedToLoad')).toBeInTheDocument();
    expect(screen.getByText('analytics failed')).toBeInTheDocument();
    expect(screen.queryByTestId('request-funnel')).not.toBeInTheDocument();
  });

  it('fills the cards and funnel from analytics and renders both tables', () => {
    render(page());

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('(requests.page.kpi.landedOf:{"count":8})')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('(requests.page.kpi.ofLanded:{"share":"75%"})')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('request-funnel'))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'requests.funnel.requested 12',
      'requests.funnel.landed 8',
      'requests.funnel.watched 6',
    ]);

    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Dune' })).toHaveAttribute('href', '/media/media-1');
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('sends both tables back to page 1 when the server picker changes', async () => {
    mockLists(45);

    const { rerender } = render(page());

    const [unplayedNext, requestersNext] = screen.getAllByRole('button', {
      name: 'common:actions.next',
    });
    if (!unplayedNext || !requestersNext) throw new Error('missing a pager');
    await userEvent.click(unplayedNext);
    await userEvent.click(requestersNext);
    expect(lastCall(mockUseRequestsUnplayed)?.[1]).toMatchObject({ page: 2 });
    expect(lastCall(mockUseRequesters)?.[1]).toMatchObject({ page: 2 });

    mockUseServer.mockReturnValue(serverScope(['srv-2']));
    rerender(page());

    expect(lastCall(mockUseRequestsUnplayed)).toEqual([
      ['srv-2'],
      { page: 1, pageSize: 20, enabled: true, sortBy: 'fileSizeBytes', sortOrder: 'desc' },
    ]);
    expect(lastCall(mockUseRequesters)).toEqual([
      ['srv-2'],
      { page: 1, pageSize: 20, enabled: true, sortBy: 'watched', sortOrder: 'desc' },
    ]);
  });
});
