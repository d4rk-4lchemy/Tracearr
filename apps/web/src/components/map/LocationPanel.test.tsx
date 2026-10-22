import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { LocationStats, LocationUserInfo, SessionWithDetails } from '@tracearr/shared';
import { LocationPanel } from './LocationPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

// jsdom cannot lay out the real scroll container, so every row is rendered.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => options.count * options.estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        start: index * options.estimateSize(),
        size: options.estimateSize(),
      })),
    measureElement: vi.fn(),
  }),
}));

const history = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  useHistorySessions: vi.fn(),
}));

vi.mock('@/hooks/queries', () => ({
  useHistorySessions: (...args: unknown[]) => {
    history.useHistorySessions(...args);
    return history.result;
  },
}));

vi.mock('@/components/history/SessionDetailSheet', () => ({
  SessionDetailSheet: ({ session, open }: { session: SessionWithDetails | null; open: boolean }) =>
    open && session ? <div data-testid="session-sheet">{session.id}</div> : null,
}));

function person(username: string, count: number): LocationUserInfo {
  return {
    id: `su-${username}`,
    username,
    identityName: null,
    thumbUrl: null,
    serverId: 'server-1',
    serverUserIds: [`su-${username}`],
    count,
  };
}

function session(id: string, title: string): SessionWithDetails {
  return {
    id,
    serverId: 'server-1',
    serverUserId: 'su-jordan',
    server: { id: 'server-1', name: 'Plex', type: 'plex' },
    user: { id: 'su-jordan', username: 'jordan', thumbUrl: null, identityName: null },
    state: 'stopped',
    mediaType: 'episode',
    mediaTitle: 'Who Is Alive?',
    grandparentTitle: title,
    seasonNumber: 2,
    episodeNumber: 4,
    thumbPath: '/library/metadata/1/thumb',
    playerName: 'Apple TV',
    startedAt: new Date('2026-10-19T21:42:00Z'),
    durationMs: 3_120_000,
  } as unknown as SessionWithDetails;
}

const ogden: LocationStats = {
  city: 'Ogden',
  region: 'Utah',
  country: 'US',
  isLocal: false,
  lat: 41.2,
  lon: -111.9,
  count: 3,
  firstActivity: new Date('2026-10-03T20:15:00Z'),
  lastActivity: new Date('2026-10-19T21:42:00Z'),
  deviceCount: 2,
  users: [person('jordan', 2), person('sam_k', 1)],
  peopleCount: 2,
  servers: [{ serverId: 'server-1', count: 3 }],
};

function sessionsResult(overrides: Record<string, unknown> = {}) {
  history.result = {
    data: {
      pages: [{ data: [session('s1', 'Severance')] }, { data: [session('s2', 'The Bear')] }],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
  return history.result;
}

function renderPanel(props: Partial<Parameters<typeof LocationPanel>[0]> = {}) {
  const onBack = vi.fn();
  const onSelectPerson = vi.fn();
  render(
    <MemoryRouter>
      <LocationPanel
        location={ogden}
        historyFilters={{ geoCity: 'Ogden' }}
        historyHref="/history?countries=US&city=Ogden"
        onBack={onBack}
        onSelectPerson={onSelectPerson}
        {...props}
      />
    </MemoryRouter>
  );
  return { onBack, onSelectPerson };
}

describe('LocationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionsResult();
  });

  it('shows the place, its region and country, and the totals', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Ogden' })).toBeInTheDocument();
    expect(screen.getByText('Utah · United States of America')).toBeInTheDocument();
    const stats = screen.getByTestId('location-stats');
    expect(within(stats).getByText('3')).toBeInTheDocument();
    expect(within(stats).getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('map.firstSeen')).toBeInTheDocument();
    expect(screen.getByText('map.lastSeen')).toBeInTheDocument();
  });

  it('moves focus to the heading when it opens', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Ogden' })).toHaveFocus();
  });

  it('lists every person in order with their counts and reports a click', async () => {
    const { onSelectPerson } = renderPanel();
    const people = within(screen.getByTestId('location-people')).getAllByRole('button');
    const [jordan, sam] = people;
    if (people.length !== 2 || !jordan || !sam) throw new Error('expected two people');
    expect(jordan).toHaveTextContent('jordan');
    expect(within(jordan).getByText('map.streamCount:2')).toBeInTheDocument();
    expect(sam).toHaveTextContent('sam_k');

    await userEvent.click(sam);
    expect(onSelectPerson).toHaveBeenCalledWith(ogden.users?.[1]);
  });

  it('queries the sessions with the given filters and renders every loaded page', () => {
    renderPanel();
    expect(history.useHistorySessions).toHaveBeenCalledWith({ geoCity: 'Ogden' });
    expect(screen.getByText('Severance')).toBeInTheDocument();
    expect(screen.getByText('The Bear')).toBeInTheDocument();
  });

  it('loads the next page when scrolled near the end while more exist', () => {
    const result = sessionsResult({ hasNextPage: true });
    renderPanel();
    fireEvent.scroll(screen.getByTestId('location-sessions'));
    expect(result.fetchNextPage).toHaveBeenCalled();
  });

  it('opens the session sheet for a clicked session', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /The Bear/ }));
    expect(screen.getByTestId('session-sheet')).toHaveTextContent('s2');
  });

  it('shows skeleton rows while the first page loads', () => {
    sessionsResult({ data: undefined, isLoading: true });
    renderPanel();
    expect(
      screen.getByTestId('location-sessions').querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0);
  });

  it('links to History with the stream count', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /map\.viewInHistory:3/ })).toHaveAttribute(
      'href',
      '/history?countries=US&city=Ogden'
    );
  });

  it('goes back on the back button and on Escape', async () => {
    const { onBack } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /map\.allLocations/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('splits the count by server when given server names and more than one server', () => {
    renderPanel({
      location: {
        ...ogden,
        servers: [
          { serverId: 'server-1', count: 2 },
          { serverId: 'server-2', count: 1 },
        ],
      },
      serverNames: { 'server-1': 'Plex', 'server-2': 'Jelly' },
    });
    expect(screen.getByText('Plex')).toBeInTheDocument();
    expect(screen.getByText('Jelly')).toBeInTheDocument();
  });
});
