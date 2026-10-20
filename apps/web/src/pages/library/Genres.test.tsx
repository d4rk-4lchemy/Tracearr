import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { GenreDetailResponse, GenreRow, GenresResponse } from '@tracearr/shared';
import { LibraryLayout } from './LibraryLayout';
import { LibraryGenres } from './Genres';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/hooks/queries', () => ({
  useGenres: vi.fn(),
  useGenreDetail: vi.fn(),
}));

vi.mock('@/hooks/useServer', () => ({ useServer: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'member' } }) }));

vi.mock('@/components/ui/time-range-picker', () => ({
  TimeRangePicker: ({ onChange }: { onChange: (value: { period: string }) => void }) => (
    <button type="button" onClick={() => onChange({ period: 'year' })}>
      range picker
    </button>
  ),
}));

vi.mock('@/components/charts/PlaysChart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/charts/PlaysChart')>()),
  PlaysChart: () => <div data-testid="plays-chart" />,
}));

vi.mock('@/components/library/LibraryEmptyState', () => ({
  LibraryEmptyState: () => <div data-testid="library-empty-state" />,
}));

import { useGenreDetail, useGenres } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const mockUseGenres = vi.mocked(useGenres);
const mockUseGenreDetail = vi.mocked(useGenreDetail);
const mockUseServer = vi.mocked(useServer);

function serverReturn(overrides: Partial<ReturnType<typeof useServer>> = {}) {
  return {
    mediaLibraryServerIds: ['srv-1'],
    mediaLibraryServers: [{ id: 'srv-1' }],
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useServer>;
}

function queryReturn<T>(
  overrides: { data?: T; isLoading?: boolean; isError?: boolean; refetch?: () => void } = {}
) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useGenres>;
}

function row(genre: string, overrides: Partial<GenreRow> = {}): GenreRow {
  return {
    genre,
    itemCount: 10,
    sizeBytes: 50 * 1024 ** 3,
    plays: 10,
    priorPlays: 10,
    watchTimeMs: 4 * 3_600_000,
    finishedRate: 60,
    topViewer: {
      userId: 'u-1',
      serverUserId: 'su-1',
      name: 'Dana',
      thumbUrl: null,
      serverId: 'srv-1',
      share: 40,
    },
    neverPlayed: { count: 2, bytes: 8 * 1024 ** 3 },
    trend: [1, 2, 1, 2, 1, 2, 1],
    ...overrides,
  };
}

const ROWS: GenreRow[] = [
  row('Action', { itemCount: 40, plays: 12, priorPlays: 20 }),
  row('Comedy', { itemCount: 55, plays: 30, priorPlays: 15 }),
  row('Drama', { itemCount: 20, plays: 5, priorPlays: 5, topViewer: null }),
];

function response(data: GenreRow[]): GenresResponse {
  return {
    data,
    hourly: [
      { hour: 20, count: 9 },
      { hour: 21, count: 14 },
    ],
    totals: { items: 100, plays: 40, priorPlays: 36 },
    range: {
      start: '2026-09-18T00:00:00.000Z',
      end: '2026-10-19T00:00:00.000Z',
      priorStart: '2026-08-18T00:00:00.000Z',
      priorEnd: '2026-09-18T00:00:00.000Z',
    },
  };
}

const DETAIL: GenreDetailResponse = {
  genre: 'Drama',
  kpis: {
    plays: 5,
    priorPlays: 5,
    finishedRate: 60,
    abandonedRate: 20,
    itemCount: 20,
    sizeBytes: 50 * 1024 ** 3,
    itemShare: 20,
    playShare: 12.5,
  },
  weekly: [{ date: '2026-10-12', count: 5 }],
  priorWeekly: [{ date: '2026-09-14', count: 5 }],
  hourly: [{ hour: 21, count: 5 }],
  topViewers: [],
  topTitles: [],
  neverPlayed: [],
};

let router: ReturnType<typeof createMemoryRouter>;

function search() {
  return router.state.location.search;
}

function renderGenres(...entries: string[]) {
  router = createMemoryRouter(
    [
      {
        path: 'library',
        element: <LibraryLayout />,
        children: [
          { index: true, element: <p>overview page</p> },
          { path: 'genres', element: <LibraryGenres /> },
        ],
      },
    ],
    { initialEntries: entries.length > 0 ? entries : ['/library/genres?period=week'] }
  );
  return render(<RouterProvider router={router} />);
}

async function goBack() {
  await act(() => router.navigate(-1));
}

function genreTable() {
  return screen.getByRole('table');
}

function firstColumn() {
  return within(genreTable())
    .getAllByRole('row')
    .slice(1)
    .map((tableRow) => within(tableRow).getAllByRole('cell')[0]?.textContent);
}

describe('LibraryGenres', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockUseServer.mockReturnValue(serverReturn());
    mockUseGenres.mockReturnValue(queryReturn({ data: response(ROWS) }));
    mockUseGenreDetail.mockReturnValue(
      queryReturn({ data: DETAIL }) as unknown as ReturnType<typeof useGenreDetail>
    );
  });

  it('uses only library servers when Dispatcharr is selected alongside Plex', () => {
    mockUseServer.mockReturnValue(
      serverReturn({
        selectedServerIds: ['srv-1', 'tv-1'],
        mediaLibraryServerIds: ['srv-1'],
      })
    );
    renderGenres();
    expect(mockUseGenres).toHaveBeenLastCalledWith('movie', ['srv-1'], { period: 'week' });
  });

  it('renders four stat cards, share bars, trends, the hour strip and the table from one response', () => {
    renderGenres();

    expect(mockUseGenres).toHaveBeenLastCalledWith('movie', ['srv-1'], { period: 'week' });
    expect(screen.getByText('pages:media.genres.cards.withPlays')).toBeInTheDocument();
    expect(screen.getByText('pages:media.genres.cards.topFiveShare')).toBeInTheDocument();
    expect(screen.getByText('pages:media.genres.cards.largestRise')).toBeInTheDocument();
    expect(screen.getByText('pages:media.genres.cards.largestFall')).toBeInTheDocument();
    expect(screen.getByText('pages:media.genres.share.title')).toBeInTheDocument();
    expect(screen.getByText('pages:media.genres.trends.title')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'userDetail.overview.byHour' }).querySelectorAll('li')
    ).toHaveLength(24);
    expect(firstColumn()).toEqual(['Comedy', 'Action', 'Drama']);
  });

  it('keeps ?period when the media type changes and keeps ?type when the range changes', async () => {
    const user = userEvent.setup();
    renderGenres();

    await user.click(screen.getByRole('radio', { name: 'common:media.artist_plural' }));
    expect(search()).toBe('?period=week&type=artist');
    expect(mockUseGenres).toHaveBeenLastCalledWith('artist', ['srv-1'], { period: 'week' });

    await user.click(screen.getByRole('button', { name: 'range picker' }));
    expect(search()).toBe('?period=year&type=artist');
    expect(mockUseGenres).toHaveBeenLastCalledWith('artist', ['srv-1'], { period: 'year' });
  });

  it('sorts the table by any column header', async () => {
    const user = userEvent.setup();
    renderGenres();

    const header = (name: string) => within(genreTable()).getByRole('button', { name });

    await user.click(header('common:labels.items'));
    expect(firstColumn()).toEqual(['Comedy', 'Action', 'Drama']);
    await user.click(header('common:labels.items'));
    expect(firstColumn()).toEqual(['Drama', 'Action', 'Comedy']);

    await user.click(header('pages:userDetail.cards.vsPrior'));
    expect(firstColumn()).toEqual(['Comedy', 'Drama', 'Action']);

    await user.click(header('pages:media.genres.table.columns.genre'));
    expect(firstColumn()).toEqual(['Action', 'Comedy', 'Drama']);
  });

  it('sends a custom range as the UTC days picked, whatever the browser zone', () => {
    vi.stubEnv('TZ', 'Pacific/Auckland');
    renderGenres('/library/genres?period=custom&from=2026-09-01&to=2026-09-30&genre=Drama');

    const range = {
      period: 'custom',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
    };
    expect(mockUseGenres).toHaveBeenLastCalledWith('movie', ['srv-1'], range);
    expect(mockUseGenreDetail).toHaveBeenLastCalledWith('Drama', 'movie', ['srv-1'], range, {
      enabled: true,
    });
    vi.unstubAllEnvs();
  });

  it('opens the sheet for ?genre=Drama and closes it by clearing the param', async () => {
    const user = userEvent.setup();
    renderGenres();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(genreTable()).getByText('Drama'));
    expect(search()).toBe('?period=week&genre=Drama');
    const sheet = screen.getByRole('dialog', { name: 'Drama' });
    expect(mockUseGenreDetail).toHaveBeenLastCalledWith(
      'Drama',
      'movie',
      ['srv-1'],
      { period: 'week' },
      { enabled: true }
    );
    expect(within(sheet).getByText('pages:media.genres.share.plays')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(search()).toBe('?period=week');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the sheet as a history entry that Back closes', async () => {
    const user = userEvent.setup();
    renderGenres();

    await user.click(within(genreTable()).getByText('Drama'));
    expect(router.state.historyAction).toBe('PUSH');

    await goBack();
    expect(search()).toBe('?period=week');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing a sheet opened in the app returns to the entry before it', async () => {
    const user = userEvent.setup();
    renderGenres('/library', '/library/genres?period=week');

    await user.click(within(genreTable()).getByText('Drama'));
    await user.keyboard('{Escape}');
    expect(router.state.historyAction).toBe('POP');
    expect(search()).toBe('?period=week');

    await goBack();
    expect(router.state.location.pathname).toBe('/library');
  });

  it('closing after a type change under an open sheet keeps the type and drops the genre', async () => {
    const user = userEvent.setup();
    renderGenres('/library', '/library/genres?period=week');

    await user.click(within(genreTable()).getByText('Drama'));
    // A bare click: a pointer press outside the modal sheet would dismiss it first.
    fireEvent.click(screen.getByRole('radio', { name: 'common:media.tvShows', hidden: true }));
    expect(search()).toBe('?period=week&genre=Drama&type=show');

    await user.keyboard('{Escape}');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(search()).toBe('?period=week&type=show');
  });

  it('closing a sheet loaded from a ?genre= link replaces that one entry', async () => {
    const user = userEvent.setup();
    renderGenres('/library', '/library/genres?period=week&genre=Drama');
    expect(screen.getByRole('dialog', { name: 'Drama' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(search()).toBe('?period=week');

    await goBack();
    expect(router.state.location.pathname).toBe('/library');
  });

  it('renders a dash for a null top viewer', () => {
    renderGenres();

    const drama = within(genreTable()).getByText('Drama').closest('tr');
    const comedy = within(genreTable()).getByText('Comedy').closest('tr');
    expect(drama && within(drama).getAllByRole('cell')[7]).toHaveTextContent(/^—$/);
    expect(comedy && within(comedy).getAllByRole('cell')[7]).toHaveTextContent('Dana · 40%');
  });

  it('says there is no play data in the trend and hour cards when nothing was played', () => {
    mockUseGenres.mockReturnValue(
      queryReturn({
        data: {
          ...response(ROWS.map((genre) => ({ ...genre, plays: 0, trend: [0, 0, 0, 0, 0, 0, 0] }))),
          hourly: [],
        },
      })
    );
    renderGenres();

    expect(screen.getAllByText('common:empty.noPlayData')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'userDetail.overview.byHour' })).toBeNull();
  });

  it('shows the empty state when no genre has items', () => {
    mockUseGenres.mockReturnValue(
      queryReturn({ data: response([row('Drama', { itemCount: 0, plays: 3 })]) })
    );
    renderGenres();

    expect(screen.getByText('media.genres.empty.title')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers a retry when the genres query fails', async () => {
    const refetch = vi.fn();
    mockUseGenres.mockReturnValue(queryReturn({ isError: true, refetch }));
    const user = userEvent.setup();
    renderGenres();

    await user.click(screen.getByRole('button', { name: /actions.tryAgain/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows the sync-aware LibraryEmptyState when no servers are selected', () => {
    mockUseServer.mockReturnValue(serverReturn({ mediaLibraryServerIds: [] }));
    renderGenres();

    expect(screen.getByTestId('library-empty-state')).toBeInTheDocument();
  });
});
