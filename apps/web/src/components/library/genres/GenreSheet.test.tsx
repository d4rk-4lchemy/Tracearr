import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { GenreDetailResponse, LibraryMediaType } from '@tracearr/shared';
import { GenreSheet } from './GenreSheet';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/hooks/queries', () => ({ useGenreDetail: vi.fn() }));

vi.mock('@/components/charts/PlaysChart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/charts/PlaysChart')>()),
  PlaysChart: ({ comparisons }: { comparisons: { name: string }[] }) => (
    <div data-testid="plays-chart">{comparisons.map((series) => series.name).join(',')}</div>
  ),
}));

import { useGenreDetail } from '@/hooks/queries';

const mockUseGenreDetail = vi.mocked(useGenreDetail);

const DETAIL: GenreDetailResponse = {
  genre: 'Sci-Fi',
  kpis: {
    plays: 24,
    priorPlays: 16,
    finishedRate: 64,
    abandonedRate: 18,
    itemCount: 41,
    sizeBytes: 310 * 1024 ** 3,
    itemShare: 8.2,
    playShare: 11.4,
  },
  weekly: [
    { date: '2026-09-28', count: 10 },
    { date: '2026-10-05', count: 14 },
  ],
  priorWeekly: [
    { date: '2026-08-31', count: 7 },
    { date: '2026-09-07', count: 9 },
  ],
  hourly: [{ hour: 22, count: 8 }],
  topViewers: [
    {
      userId: 'u-1',
      serverUserId: 'su-1',
      name: 'Marcus',
      thumbUrl: '/users/marcus.png',
      serverId: 'srv-1',
      share: 50,
    },
    {
      userId: 'u-2',
      serverUserId: 'su-2',
      name: 'Lena',
      thumbUrl: null,
      serverId: 'srv-1',
      share: 25,
    },
  ],
  topTitles: [
    {
      mediaId: 'm-1',
      title: 'Arrival',
      year: 2016,
      serverId: 'srv-1',
      thumbPath: '/library/metadata/101/thumb',
      plays: 9,
      sizeBytes: 18 * 1024 ** 3,
    },
  ],
  neverPlayed: [
    {
      mediaId: 'm-2',
      title: 'Sunshine',
      year: 2007,
      serverId: 'srv-1',
      thumbPath: null,
      plays: 0,
      sizeBytes: 12 * 1024 ** 3,
    },
  ],
};

function renderSheet(type: LibraryMediaType, onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <GenreSheet
        genre="Sci-Fi"
        type={type}
        serverIds={['srv-1']}
        timeRange={{ period: 'month' }}
        comparePeakHour={21}
        onClose={onClose}
      />
    </MemoryRouter>
  );
  return screen.getByRole('dialog', { name: 'Sci-Fi' });
}

describe('GenreSheet', () => {
  beforeEach(() => {
    mockUseGenreDetail.mockReturnValue({
      data: DETAIL,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGenreDetail>);
  });

  it('renders the four tiles, the prior comparison, the viewers, and linked titles', () => {
    const sheet = renderSheet('movie');

    expect(within(sheet).getByText('24')).toBeInTheDocument();
    expect(within(sheet).getByText('+50%')).toBeInTheDocument();
    expect(within(sheet).getByText('64%')).toBeInTheDocument();
    expect(within(sheet).getByText('8.2%')).toBeInTheDocument();
    expect(within(sheet).getByText('11.4%')).toBeInTheDocument();
    expect(within(sheet).getByTestId('plays-chart')).toHaveTextContent(
      'pages:userDetail.overview.priorRange'
    );
    expect(
      within(sheet).getByText('pages:media.landing.shelves.captionMostPopular.month')
    ).toBeInTheDocument();
    expect(within(sheet).getByText('pages:media.genres.sheet.ofCountedPlays')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Marcus' })).toHaveAttribute(
      'href',
      '/users/su-1'
    );
    expect(within(sheet).getByText('L')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Arrival/ })).toHaveAttribute(
      'href',
      '/media/m-1'
    );
    expect(within(sheet).getByText('12 GB')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('link', { name: 'pages:media.genres.sheet.browse' })
    ).toHaveAttribute('href', '/media/browse?genre=Sci-Fi');
  });

  it('leaves artist titles unlinked and browses the genre on the artist grid', () => {
    const sheet = renderSheet('artist');

    expect(within(sheet).getByText('Arrival')).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: /Arrival/ })).toBeNull();
    expect(
      within(sheet).getByRole('link', { name: 'pages:media.genres.sheet.browse' })
    ).toHaveAttribute('href', '/media/browse?type=artist&genre=Sci-Fi');
  });

  it('counts and lists artists on the artist sheet, titles on the others', () => {
    const artist = renderSheet('artist');
    expect(
      within(artist).getByText(/pages:media\.genres\.sheet\.artistCount:\{"count":41\}/)
    ).toBeInTheDocument();
    expect(within(artist).getByText('pages:media.genres.sheet.topArtists')).toBeInTheDocument();
    expect(within(artist).queryByText('pages:media.genres.sheet.topTitles')).toBeNull();
    cleanup();

    const movie = renderSheet('movie');
    expect(
      within(movie).getByText(/pages:media\.genres\.chart\.itemCount:\{"count":41\}/)
    ).toBeInTheDocument();
    expect(within(movie).getByText('pages:media.genres.sheet.topTitles')).toBeInTheDocument();
    expect(within(movie).queryByText('pages:media.genres.sheet.topArtists')).toBeNull();
  });

  it('calls onClose when dismissed', async () => {
    const onClose = vi.fn();
    renderSheet('show', onClose);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
