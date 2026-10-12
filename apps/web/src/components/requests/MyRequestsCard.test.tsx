import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { UserRequestEntry, UserRequestsResponse } from '@tracearr/shared';
import { MyRequestsCard } from './MyRequestsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/hooks/queries', () => ({
  useMyRequests: vi.fn(),
  useRequestsConfigured: vi.fn(),
}));

import { useMyRequests, useRequestsConfigured } from '@/hooks/queries';

function entry(id: string, overrides: Partial<UserRequestEntry['media']> = {}): UserRequestEntry {
  return {
    id,
    serverId: 's1',
    status: 'completed',
    requestedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    availableAt: null,
    waitMs: null,
    deletedAt: null,
    seasons: null,
    is4k: false,
    isAutoRequest: false,
    watchedState: 'unwatched',
    watchedStateRequester: 'unwatched',
    media: {
      mediaId: `m-${id}`,
      title: `Title ${id}`,
      year: 2024,
      mediaType: 'movie',
      posterUrl: `/api/v1/images/proxy?id=${id}`,
      ...overrides,
    },
  };
}

function load(configured: boolean, rows: UserRequestEntry[], total: number, available = 0) {
  vi.mocked(useRequestsConfigured).mockReturnValue({
    data: { configured },
  } as ReturnType<typeof useRequestsConfigured>);
  const data: UserRequestsResponse = {
    data: rows,
    total,
    page: 1,
    pageSize: 4,
    summary: {
      total,
      approvalRate: null,
      completed: 0,
      neverWatched: 0,
      medianWaitMs: null,
      availableThisWeek: available,
    },
  };
  vi.mocked(useMyRequests).mockReturnValue({ data } as ReturnType<typeof useMyRequests>);
}

function renderCard() {
  return render(
    <MemoryRouter>
      <MyRequestsCard />
    </MemoryRouter>
  );
}

describe('MyRequestsCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing while no request service is linked, and asks for no rows', () => {
    load(false, [entry('1')], 1);

    const { container } = renderCard();

    expect(container).toBeEmptyDOMElement();
    expect(vi.mocked(useMyRequests).mock.calls[0]?.[0]).toMatchObject({ enabled: false });
  });

  it('renders nothing when the person has no requests', () => {
    load(true, [], 0);

    const { container } = renderCard();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists each request with its poster, title link and status badge', () => {
    load(true, [entry('1'), entry('2', { posterUrl: null, mediaId: null })], 2);

    renderCard();

    expect(screen.getByRole('link', { name: 'Title 1' })).toHaveAttribute('href', '/media/m-1');
    expect(screen.getByText('Title 2')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Title 2' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getAllByText('requests.status.completed')).toHaveLength(2);
    expect(screen.getAllByText(/requestedAgo.*3d/)).toHaveLength(2);
  });

  it('mentions what became available this week only when something did', () => {
    load(true, [entry('1')], 1, 0);
    const { unmount } = renderCard();
    expect(screen.queryByText(/availableThisWeek/)).not.toBeInTheDocument();
    unmount();

    load(true, [entry('1')], 1, 2);
    renderCard();
    expect(screen.getByText(/availableThisWeek.*2/)).toBeInTheDocument();
  });

  it('links to all requests only past four', () => {
    load(true, [entry('1')], 4);
    const { unmount } = renderCard();
    expect(screen.queryByRole('link', { name: /seeAll/ })).not.toBeInTheDocument();
    unmount();

    load(true, [entry('1')], 5);
    renderCard();
    expect(screen.getByRole('link', { name: /seeAll/ })).toHaveAttribute('href', '/requests');
  });
});
