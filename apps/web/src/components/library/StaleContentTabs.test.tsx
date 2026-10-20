import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StaleItem, StaleResponse } from '@tracearr/shared';
import { StaleContentTabs } from './StaleContentTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const mockUseLibraryStale = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries/useLibrary', () => ({ useLibraryStale: mockUseLibraryStale }));
vi.mock('@/hooks/useServerColorMap', () => ({ useServerColorMap: () => new Map() }));
vi.mock('@/components/server', () => ({ ServerColumnCell: () => null }));

const item: StaleItem = {
  id: 'i-1',
  serverId: 'srv-1',
  serverName: 'Main',
  libraryId: 'lib-1',
  libraryName: 'Movies',
  title: 'Heat',
  mediaType: 'movie',
  year: 1995,
  fileSize: 10 * 1024 ** 3,
  resolution: '1080p',
  addedAt: '2024-01-01T00:00:00Z',
  lastWatched: null,
  watchCount: 0,
  category: 'stale',
  daysStale: 400,
};

function response(items: StaleItem[]): StaleResponse {
  return {
    items,
    summary: {
      neverWatched: { count: 4, sizeBytes: 0 },
      stale: { count: 7, sizeBytes: 0 },
      total: { count: 11, sizeBytes: 0 },
      threshold: { days: 90 },
    },
    pagination: { page: 1, pageSize: 20, total: items.length },
  };
}

function renderTabs() {
  return render(
    <StaleContentTabs serverIds={['srv-1']} isMultiServer={false} selectedServers={[]} />
  );
}

describe('StaleContentTabs', () => {
  beforeEach(() => {
    mockUseLibraryStale.mockReturnValue({ isLoading: false, data: response([item]) });
  });

  it('labels the tabs with their counts and the table with translated columns', () => {
    renderTabs();

    expect(
      screen.getByRole('tab', { name: 'library.storage.stale.tabs.neverWatched:{"count":4}' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'library.storage.stale.tabs.stale:{"count":7}' })
    ).toBeInTheDocument();
    for (const name of [
      'common:labels.type',
      'library.storage.colTitle',
      'common:labels.size',
      'library.overview.added',
      'common:labels.quality',
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('words how long an item has been stale from translations', async () => {
    renderTabs();
    await userEvent.click(
      screen.getByRole('tab', { name: 'library.storage.stale.tabs.stale:{"count":7}' })
    );

    expect(
      screen.getByText('library.storage.stale.age.yearsMonths:{"years":1,"months":1}')
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: 'library.storage.stale.columns.staleFor' })
    ).toBeVisible();
  });

  it('returns to the first page when the sort changes', async () => {
    mockUseLibraryStale.mockReturnValue({
      isLoading: false,
      data: { ...response([item]), pagination: { page: 1, pageSize: 20, total: 60 } },
    });
    const neverWatchedPage = () => {
      const calls = mockUseLibraryStale.mock.calls.filter((call) => call[3] === 'never_watched');
      return calls[calls.length - 1]?.[4];
    };
    renderTabs();

    await userEvent.click(screen.getByRole('button', { name: 'common:actions.next' }));
    expect(neverWatchedPage()).toBe(2);

    await userEvent.click(screen.getByRole('button', { name: 'library.storage.colTitle' }));
    expect(neverWatchedPage()).toBe(1);
  });

  it('shows the loading and empty states from translations', () => {
    mockUseLibraryStale.mockReturnValue({ isLoading: true, data: undefined });
    const { rerender } = renderTabs();
    expect(screen.getByText('common:states.loading')).toBeInTheDocument();

    mockUseLibraryStale.mockReturnValue({ isLoading: false, data: response([]) });
    rerender(<StaleContentTabs serverIds={['srv-1']} isMultiServer={false} selectedServers={[]} />);
    expect(screen.getByText('library.storage.stale.empty.title')).toBeInTheDocument();
    expect(screen.getByText('library.storage.stale.empty.description')).toBeInTheDocument();
  });
});
