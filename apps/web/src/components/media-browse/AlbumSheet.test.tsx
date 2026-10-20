import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import type { AlbumDetailResponse } from '@tracearr/shared';
import { AlbumSheet } from './AlbumSheet';

vi.mock('@/hooks/queries', () => ({ useAlbumDetail: vi.fn() }));

import { useAlbumDetail } from '@/hooks/queries';

const mockUseAlbumDetail = vi.mocked(useAlbumDetail);

const TITLES = [
  'Overture',
  'The Good Part',
  'Weak',
  'Sober Up',
  'Drama',
  'Turning Out',
  'No Grass Today',
  'Three-Thirty',
  'Call My Dad',
  "I'm Not Famous",
  'Netflix Trip',
  'Bud Like You',
  'Come Hang Out',
];

const DETAIL: AlbumDetailResponse = {
  album: {
    id: 'album-click',
    title: 'The Click',
    artistTitle: 'AJR',
    artistMediaId: 'artist-ajr',
    year: 2017,
    trackCount: 13,
    durationMs: null,
    addedAt: '2024-11-17T20:00:00.000Z',
    posterUrl: '/api/v1/images/proxy?server=srv-plex&url=%2Flibrary%2Fmetadata%2F9001%2Fthumb',
    posterVersion: 'abc123',
    copies: [{ serverId: 'srv-plex', ratingKey: '9001' }],
  },
  last30: { plays: 58, priorPlays: 52, listenMs: 13_200_000 },
  allTime: {
    plays: 80,
    listeners: [
      { name: 'Becca', plays: 55, share: 68.8 },
      { name: 'Gallapagos', plays: 25, share: 31.3 },
    ],
    finishedRate: 71,
  },
  tracks: TITLES.map((title, index) => {
    const played = index < 11;
    return {
      index: index + 1,
      title,
      durationMs: null,
      plays: played ? index + 2 : 0,
      lastPlayedAt: played ? '2026-10-16T00:00:00.000Z' : null,
    };
  }),
};

function queryReturn(overrides: Record<string, unknown> = {}) {
  return {
    data: DETAIL,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAlbumDetail>;
}

const SERVERS = new Map([
  ['srv-plex', { name: 'Plex', type: 'plex' as const, machineIdentifier: 'abc' }],
]);

function renderSheet(props: Partial<Parameters<typeof AlbumSheet>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <AlbumSheet
      albumId="album-click"
      serverIds={['srv-plex']}
      serverById={SERVERS}
      isMember={false}
      onClose={onClose}
      {...props}
    />
  );
  return { onClose, sheet: screen.getByRole('dialog', { name: 'The Click' }) };
}

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T15:00:00Z'));
  mockUseAlbumDetail.mockReturnValue(queryReturn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AlbumSheet', () => {
  it('heads the sheet with the artist, year, track count and added date', () => {
    const { sheet } = renderSheet();

    expect(mockUseAlbumDetail).toHaveBeenLastCalledWith('album-click', ['srv-plex'], true);
    expect(within(sheet).getByText('Album · AJR · 2017')).toBeInTheDocument();
    expect(within(sheet).getByText('13 tracks · added Nov 17, 2024')).toBeInTheDocument();
    expect(sheet.querySelector('img')?.getAttribute('src')).toContain('width=360&height=360');
  });

  it('shows the initials tile when the album has no poster', () => {
    mockUseAlbumDetail.mockReturnValue(
      queryReturn({ data: { ...DETAIL, album: { ...DETAIL.album, posterUrl: null } } })
    );
    const { sheet } = renderSheet();

    expect(sheet.querySelector('img')).toBeNull();
    expect(within(sheet).getByText('TC')).toBeInTheDocument();
  });

  it('swaps to the initials tile when the poster fails to load', () => {
    const { sheet } = renderSheet();

    fireEvent.error(sheet.querySelector('img')!);

    expect(sheet.querySelector('img')).toBeNull();
    expect(within(sheet).getByText('TC')).toBeInTheDocument();
  });

  it('renders the four tiles and every track in album order', () => {
    const { sheet } = renderSheet();

    expect(within(sheet).getByText('58')).toBeInTheDocument();
    expect(within(sheet).getByText('+12%')).toBeInTheDocument();
    expect(within(sheet).getByText('3h 40m')).toBeInTheDocument();
    expect(within(sheet).getByText('Listen Time')).toBeInTheDocument();
    expect(within(sheet).getByText('Becca 69% · Gallapagos 31%')).toBeInTheDocument();
    expect(within(sheet).getByText('71%')).toBeInTheDocument();

    const rows = within(within(sheet).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(13);
    expect(rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual(TITLES);
    expect(within(rows[0] as HTMLElement).getByText('Oct 16')).toBeInTheDocument();
  });

  it('marks never-played tracks with the dash', () => {
    const { sheet } = renderSheet();

    const rows = within(within(sheet).getByRole('table')).getAllByRole('row').slice(1);
    const neverPlayed = rows[12] as HTMLElement;
    const cells = within(neverPlayed).getAllByRole('cell');
    expect(cells[1]?.firstElementChild).toHaveClass('text-muted-foreground');
    expect(cells[2]).toHaveTextContent(/^—$/);
    expect(cells[3]).toHaveTextContent(/^—$/);
  });

  it('hides the listeners tile for a member who sees no one else', () => {
    mockUseAlbumDetail.mockReturnValue(
      queryReturn({ data: { ...DETAIL, allTime: { ...DETAIL.allTime, listeners: [] } } })
    );
    const { sheet } = renderSheet({ isMember: true });

    expect(within(sheet).queryByText('Listeners')).toBeNull();
    expect(within(sheet).getByText('Finished')).toBeInTheDocument();
  });

  it('shows the UTC day a track was last played in any browser zone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const { sheet } = renderSheet();

    const rows = within(within(sheet).getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Oct 16')).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('keeps two tracks that share a title but not a number', () => {
    mockUseAlbumDetail.mockReturnValue(
      queryReturn({
        data: {
          ...DETAIL,
          tracks: [
            { index: 1, title: 'Overture', durationMs: null, plays: 2, lastPlayedAt: null },
            { index: 14, title: 'Overture', durationMs: null, plays: 0, lastPlayedAt: null },
          ],
        },
      })
    );
    const { sheet } = renderSheet();

    expect(within(sheet).getAllByText('Overture')).toHaveLength(2);
  });

  it('links the copy on its server', () => {
    const { sheet } = renderSheet();

    expect(within(sheet).getByRole('link', { name: /Open on server/ })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('/library/metadata/9001'))
    );
  });

  it('renders no footer when no copy is on a known server', () => {
    const { sheet } = renderSheet({ serverById: new Map() });

    expect(within(sheet).queryByRole('link', { name: /Open on server/ })).toBeNull();
    expect(sheet.querySelector('[data-slot="sheet-footer"]')).toBeNull();
  });

  it('closes from its close button', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { sheet, onClose } = renderSheet();

    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the error state with a retry', async () => {
    vi.useRealTimers();
    const refetch = vi.fn();
    mockUseAlbumDetail.mockReturnValue(queryReturn({ data: undefined, isError: true, refetch }));
    const user = userEvent.setup();
    render(
      <AlbumSheet
        albumId="album-click"
        serverIds={[]}
        serverById={SERVERS}
        isMember={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Couldn't load this album")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
