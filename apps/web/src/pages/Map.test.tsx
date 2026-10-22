import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import type { LocationStats } from '@tracearr/shared';
import { locationKey } from '@/components/map/locationKey';
import { Map as MapPage } from './Map';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const streamMap = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));

vi.mock('@/components/map/StreamMap', () => ({
  StreamMap: (props: Record<string, unknown>) => {
    streamMap.props = props;
    return <div data-testid="stream-map" />;
  },
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

vi.mock('@/hooks/queries', () => ({
  useLocationStats: vi.fn(),
  useLocationPeople: vi.fn(),
  useHistorySessions: () => ({
    data: undefined,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

vi.mock('@/hooks/useServerColorMap', () => ({
  useServerColorMap: () => new Map(),
}));

import { useLocationPeople, useLocationStats } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const mockUseLocationStats = vi.mocked(useLocationStats);
const mockUseLocationPeople = vi.mocked(useLocationPeople);
const mockUseServer = vi.mocked(useServer);

function renderMap() {
  return render(
    <MemoryRouter>
      <MapPage />
    </MemoryRouter>
  );
}

function renderMapAtUrl(url: string) {
  const router = createMemoryRouter([{ path: '/map', element: <MapPage /> }], {
    initialEntries: [url],
  });
  const utils = render(<RouterProvider router={router} />);
  return { router, ...utils };
}

const trenton: LocationStats = {
  city: 'Trenton',
  region: 'New Jersey',
  country: 'US',
  isLocal: false,
  lat: 40.2,
  lon: -74.7,
  count: 12,
  users: [],
  peopleCount: 0,
  servers: [],
};

function withLocations(
  locations: LocationStats[],
  users: {
    id: string;
    username: string;
    identityName: string | null;
    serverUserIds: string[];
  }[] = []
) {
  mockUseLocationStats.mockReturnValue({
    data: {
      data: locations,
      summary: { totalStreams: 12, uniqueLocations: locations.length, topCity: null },
      availableFilters: { users, mediaTypes: [] },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useLocationStats>);
}

function withPeople(locations: LocationStats[] | undefined) {
  mockUseLocationPeople.mockReturnValue({
    data: locations && { data: locations },
  } as unknown as ReturnType<typeof useLocationPeople>);
}

function person(username: string, count: number) {
  return {
    id: username,
    username,
    identityName: null,
    thumbUrl: null,
    serverId: 'server-1',
    serverUserIds: [username],
    count,
  };
}

describe('Map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withPeople(undefined);
    mockUseServer.mockReturnValue({
      selectedServerIds: [],
      selectedServers: [],
      isMultiServer: false,
    } as unknown as ReturnType<typeof useServer>);
  });

  it('shows the map once locations have loaded', async () => {
    mockUseLocationStats.mockReturnValue({
      data: { data: [], summary: undefined, availableFilters: undefined },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLocationStats>);

    renderMap();

    expect(await screen.findByTestId('stream-map')).toBeInTheDocument();
  });

  it('shows an error state instead of the map when the locations query fails, and retry refetches it', async () => {
    const refetch = vi.fn();
    mockUseLocationStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('locations failed'),
      refetch,
    } as unknown as ReturnType<typeof useLocationStats>);

    renderMap();

    expect(screen.queryByTestId('stream-map')).not.toBeInTheDocument();
    expect(screen.getByText('common:errors.somethingWentWrong')).toBeInTheDocument();
    expect(screen.getByText('locations failed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /actions.tryAgain/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('clears a selected user filter that no longer appears in the current options', async () => {
    mockUseLocationStats.mockReturnValue({
      data: {
        data: [],
        summary: { totalStreams: 0, uniqueLocations: 0, topCity: null },
        availableFilters: {
          users: [
            {
              id: 'other-user',
              username: 'bob',
              identityName: null,
              serverUserIds: ['other-user'],
            },
          ],
          mediaTypes: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLocationStats>);

    const { router } = renderMapAtUrl('/map?serverUserId=stale-user&serverUserIds=stale-user');

    await waitFor(() => expect(router.state.location.search).not.toContain('serverUserId'));
  });

  it('keeps a selected user filter that is still present in the current options', async () => {
    mockUseLocationStats.mockReturnValue({
      data: {
        data: [],
        summary: { totalStreams: 0, uniqueLocations: 0, topCity: null },
        availableFilters: {
          users: [
            {
              id: 'alice-rep',
              username: 'alice_plex',
              identityName: 'Alice',
              serverUserIds: ['alice-rep', 'alice-secondary'],
            },
          ],
          mediaTypes: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLocationStats>);

    const { router } = renderMapAtUrl(
      '/map?serverUserId=alice-rep&serverUserIds=alice-rep%2Calice-secondary'
    );

    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(router.state.location.search).toContain('serverUserId=alice-rep');
    expect(router.state.location.search).toContain('serverUserIds=alice-rep%2Calice-secondary');
  });

  it('opens in circles without a view param', async () => {
    withLocations([trenton]);
    renderMapAtUrl('/map');
    await screen.findByTestId('stream-map');
    expect(streamMap.props.viewMode).toBe('circles');
  });

  it('reads the heatmap from ?view=heatmap', async () => {
    withLocations([trenton]);
    renderMapAtUrl('/map?view=heatmap');
    await screen.findByTestId('stream-map');
    expect(streamMap.props.viewMode).toBe('heatmap');
  });

  it('links hover between the list beside the map and the map', async () => {
    withLocations([trenton]);
    renderMap();
    await screen.findByTestId('stream-map');
    const row = screen.getByRole('button', { name: /Trenton/ });

    await userEvent.hover(row);
    expect(streamMap.props.hoveredKeys).toEqual(new Set([locationKey(trenton)]));
    await userEvent.unhover(row);
    expect(streamMap.props.hoveredKeys).toEqual(new Set());

    act(() => (streamMap.props.onHover as (keys: string[] | null) => void)([locationKey(trenton)]));
    expect(row).toHaveAttribute('data-hovered', 'true');
  });

  it('lists the places in the map view and fits all from the empty view', async () => {
    const boise = { ...trenton, city: 'Boise', region: 'Idaho', lat: 43.6, lon: -116.2 };
    withLocations([trenton, boise]);
    renderMap();
    await screen.findByTestId('stream-map');
    expect(streamMap.props.fitAllSignal).toBe(0);
    const report = streamMap.props.onViewChange as (bounds: Record<string, number>) => void;

    act(() => report({ west: -80, south: 35, east: -70, north: 45 }));
    expect(screen.getByRole('button', { name: /Trenton/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Boise/ })).not.toBeInTheDocument();
    expect(screen.getByText('map.inViewCount')).toBeInTheDocument();
    expect(screen.getByText('map.locations').previousElementSibling).toHaveTextContent('2');

    act(() => report({ west: 0, south: 0, east: 10, north: 10 }));
    expect(screen.getByText('map.noneInView')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'map.showAll' }));
    expect(streamMap.props.fitAllSignal).toBe(1);
  });

  it('opens the panel for a clicked row in place of the list and links it to History', async () => {
    withLocations([trenton]);
    renderMapAtUrl('/map?period=week&mediaType=episode');
    await screen.findByTestId('stream-map');
    await userEvent.click(screen.getByRole('button', { name: /Trenton/ }));

    expect(streamMap.props.selectedMembers).toEqual(new Set([locationKey(trenton)]));
    expect(screen.getByRole('heading', { name: 'Trenton' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Trenton/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /map\.viewInHistory/ })).toHaveAttribute(
      'href',
      '/history?countries=US&city=Trenton&region=New+Jersey&network=remote&mediaTypes=episode&period=week'
    );
  });

  it('returns to the list when a refetch no longer contains the selected location', async () => {
    withLocations([trenton]);
    const { rerender } = renderMap();
    await screen.findByTestId('stream-map');
    await userEvent.click(screen.getByRole('button', { name: /Trenton/ }));
    expect(screen.getByRole('heading', { name: 'Trenton' })).toBeInTheDocument();

    withLocations([{ ...trenton, city: 'Ewing' }]);
    rerender(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('heading', { name: 'Trenton' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ewing/ })).toBeInTheDocument();
    expect(streamMap.props.selectedMembers).toEqual(new Set());
  });

  it('filters to a clicked person the way the user dropdown does and keeps the panel open', async () => {
    const alice = {
      id: 'alice-secondary',
      username: 'alice_jf',
      identityName: 'Alice',
      thumbUrl: null,
      serverId: 'server-2',
      serverUserIds: ['alice-secondary'],
      count: 12,
    };
    withLocations(
      [{ ...trenton, users: [alice], peopleCount: 1 }],
      [
        {
          id: 'alice-rep',
          username: 'alice_plex',
          identityName: 'Alice',
          serverUserIds: ['alice-rep', 'alice-secondary'],
        },
      ]
    );
    const { router } = renderMapAtUrl('/map');
    await screen.findByTestId('stream-map');
    await userEvent.click(screen.getByRole('button', { name: /Trenton/ }));
    await userEvent.click(
      within(screen.getByTestId('location-people')).getByRole('button', { name: /Alice/ })
    );

    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('serverUserId')).toBe('alice-rep');
    expect(params.get('serverUserIds')).toBe('alice-rep,alice-secondary');
    expect(screen.getByRole('heading', { name: 'Trenton' })).toBeInTheDocument();
  });

  it("shows the list's people while the place's people load, then every person", async () => {
    const listed = { ...trenton, users: [person('ann', 3)], peopleCount: 2 };
    withLocations([listed]);
    const page = () => (
      <MemoryRouter initialEntries={['/map?period=custom&from=2026-06-09&to=2026-06-10']}>
        <MapPage />
      </MemoryRouter>
    );
    const { rerender } = render(page());
    await screen.findByTestId('stream-map');
    await userEvent.click(screen.getByRole('button', { name: /Trenton/ }));

    expect(mockUseLocationPeople).toHaveBeenLastCalledWith(
      expect.objectContaining({
        timeRange: {
          period: 'custom',
          startDate: new Date(2026, 5, 9).toISOString(),
          endDate: new Date(2026, 5, 11).toISOString(),
        },
      }),
      { place: locationKey(trenton) }
    );
    const names = () =>
      within(screen.getByTestId('location-people'))
        .getAllByRole('button')
        .map((b) => b.textContent);
    expect(names()).toEqual([expect.stringContaining('ann')]);

    withPeople([{ ...listed, users: [person('ann', 3), person('bob', 1)] }]);
    rerender(page());
    expect(names()).toEqual([expect.stringContaining('ann'), expect.stringContaining('bob')]);
  });

  it('returns focus to the row that opened the panel after Back', async () => {
    withLocations([trenton]);
    renderMap();
    await screen.findByTestId('stream-map');
    await userEvent.click(screen.getByRole('button', { name: /Trenton/ }));
    await userEvent.click(screen.getByRole('button', { name: /map\.allLocations/ }));

    expect(screen.getByRole('button', { name: /Trenton/ })).toHaveFocus();
    expect(streamMap.props.selectedMembers).toEqual(new Set());
  });

  describe('areas', () => {
    const ewing: LocationStats = { ...trenton, city: 'Ewing', lat: 40.27, lon: -74.8, count: 4 };
    const area = [locationKey(trenton), locationKey(ewing)];

    function rerenderPage(rerender: ReturnType<typeof render>['rerender']) {
      rerender(
        <MemoryRouter>
          <MapPage />
        </MemoryRouter>
      );
    }

    async function openArea() {
      withLocations([trenton, ewing]);
      const utils = renderMap();
      await screen.findByTestId('stream-map');
      act(() => (streamMap.props.onSelectArea as (members: string[]) => void)(area));
      return utils;
    }

    it('shows the area panel for a clicked area and highlights its members on the map', async () => {
      await openArea();
      expect(screen.getByRole('heading', { name: 'map.areaName' })).toBeInTheDocument();
      expect(streamMap.props.selectedMembers).toEqual(new Set(area));
      expect(screen.queryByRole('link', { name: /map\.viewInHistory/ })).not.toBeInTheDocument();
    });

    it('asks for the people inside the box around the members and lists them', async () => {
      withPeople([
        { ...trenton, users: [person('ann', 3)] },
        { ...ewing, users: [person('bob', 2)] },
      ]);
      await openArea();
      expect(mockUseLocationPeople).toHaveBeenLastCalledWith(expect.anything(), {
        west: -74.8,
        south: 40.2,
        east: -74.7,
        north: 40.27,
      });
      expect(
        within(screen.getByTestId('area-people'))
          .getAllByRole('button')
          .map((b) => b.textContent)
      ).toEqual([expect.stringContaining('ann'), expect.stringContaining('bob')]);
    });

    it('opens the place panel for a place picked in the area panel', async () => {
      await openArea();
      await userEvent.click(
        within(screen.getByTestId('area-places')).getByRole('button', { name: /Ewing/ })
      );
      expect(screen.getByRole('heading', { name: 'Ewing' })).toBeInTheDocument();
      expect(streamMap.props.selectedMembers).toEqual(new Set([locationKey(ewing)]));
      expect(screen.getByRole('link', { name: /map\.viewInHistory/ })).toBeInTheDocument();
    });

    it('keeps the area panel while a refetch is loading', async () => {
      const { rerender } = await openArea();
      mockUseLocationStats.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useLocationStats>);
      rerenderPage(rerender);
      expect(screen.getByRole('heading', { name: 'map.areaName' })).toBeInTheDocument();
    });

    it('becomes the remaining place when a refetch leaves one member', async () => {
      const { rerender } = await openArea();
      withLocations([trenton]);
      rerenderPage(rerender);
      expect(screen.getByRole('heading', { name: 'Trenton' })).toBeInTheDocument();
      expect(streamMap.props.selectedMembers).toEqual(new Set([locationKey(trenton)]));
    });

    it('returns to the list when a refetch leaves no member', async () => {
      const { rerender } = await openArea();
      withLocations([{ ...trenton, city: 'Boise' }]);
      rerenderPage(rerender);
      expect(screen.queryByRole('heading', { name: 'map.areaName' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Boise/ })).toBeInTheDocument();
      expect(streamMap.props.selectedMembers).toEqual(new Set());
    });

    it('marks every member row when the map hovers an area', async () => {
      withLocations([trenton, ewing]);
      renderMap();
      await screen.findByTestId('stream-map');
      act(() => (streamMap.props.onHover as (keys: string[] | null) => void)(area));
      expect(screen.getByRole('button', { name: /Trenton/ })).toHaveAttribute(
        'data-hovered',
        'true'
      );
      expect(screen.getByRole('button', { name: /Ewing/ })).toHaveAttribute('data-hovered', 'true');
    });
  });
});
