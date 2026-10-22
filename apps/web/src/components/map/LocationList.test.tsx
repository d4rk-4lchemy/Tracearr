import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LocationStats } from '@tracearr/shared';
import { LocationList } from './LocationList';
import { locationKey } from './locationKey';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${Object.values(options).join(',')}`,
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

function location(overrides: Partial<LocationStats>): LocationStats {
  return {
    city: 'Trenton',
    region: 'New Jersey',
    country: 'US',
    isLocal: false,
    lat: 40.2,
    lon: -74.7,
    count: 1,
    users: [],
    peopleCount: 0,
    servers: [],
    ...overrides,
  };
}

const trenton = location({ count: 412, isLocal: true });
const berlin = location({ city: null, region: null, country: 'DE', count: 40 });
const unplaced = location({ city: 'Ewing', lat: null, lon: null, count: 3 });

function renderList(props: Partial<Parameters<typeof LocationList>[0]> = {}) {
  const onHover = vi.fn();
  const onSelect = vi.fn();
  render(
    <LocationList
      locations={[trenton, berlin, unplaced]}
      hoveredKeys={new Set()}
      onHover={onHover}
      onSelect={onSelect}
      {...props}
    />
  );
  return { onHover, onSelect };
}

describe('LocationList', () => {
  it('renders one button per location in the given order with rank, name, place and count', () => {
    renderList();
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows;
    if (!first || !second || !third) throw new Error('missing rows');

    expect(within(first).getByText('1')).toBeInTheDocument();
    expect(within(first).getByText('Trenton')).toBeInTheDocument();
    expect(within(first).getByText('New Jersey · US')).toBeInTheDocument();
    expect(within(first).getByText('412')).toBeInTheDocument();
    expect(within(first).getByText('labels.local')).toBeInTheDocument();

    expect(within(second).getByText('2')).toBeInTheDocument();
    expect(within(second).getByText('Germany')).toBeInTheDocument();
    expect(within(second).queryByText('labels.local')).not.toBeInTheDocument();
    expect(within(second).queryByText('map.noMapPosition')).not.toBeInTheDocument();

    expect(within(third).getByText('Ewing')).toBeInTheDocument();
    expect(within(third).getByText('map.noMapPosition')).toBeInTheDocument();
  });

  it('shows the people the list carries as avatars, then the rest of peopleCount as +N', () => {
    const people = ['ann', 'bob', 'cat'].map((username, i) => ({
      id: `su-${i}`,
      username,
      identityName: null,
      thumbUrl: null,
      serverId: 'server-1',
      serverUserIds: [`su-${i}`],
      count: 5 - i,
    }));
    renderList({ locations: [location({ users: people, peopleCount: 5 })] });
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('reports hover, leave and click with the location key', async () => {
    const { onHover, onSelect } = renderList();
    const row = screen.getByRole('button', { name: /Germany/ });

    await userEvent.hover(row);
    expect(onHover).toHaveBeenLastCalledWith(locationKey(berlin));
    await userEvent.unhover(row);
    expect(onHover).toHaveBeenLastCalledWith(null);
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(locationKey(berlin));
  });

  it('marks every hovered row', () => {
    renderList({ hoveredKeys: new Set([locationKey(berlin), locationKey(unplaced)]) });
    expect(screen.getByRole('button', { name: /Germany/ })).toHaveAttribute('data-hovered', 'true');
    expect(screen.getByRole('button', { name: /Ewing/ })).toHaveAttribute('data-hovered', 'true');
    expect(screen.getByRole('button', { name: /Trenton/ })).not.toHaveAttribute('data-hovered');
  });

  it('shows skeleton rows while loading', () => {
    const { container } = render(
      <LocationList
        locations={[]}
        isLoading
        hoveredKeys={new Set()}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  describe('in the map view', () => {
    const boise = location({ city: 'Boise', region: 'Idaho', lat: 43.6, lon: -116.2, count: 20 });
    const east = { west: -80, south: 35, east: -70, north: 45 };

    it('lists only the placed rows inside the bounds, then the unplaced ones, with global ranks', () => {
      renderList({ locations: [trenton, boise, unplaced], bounds: east });
      const rows = screen.getAllByRole('button');
      expect(rows.map((row) => row.dataset.key)).toEqual([
        locationKey(trenton),
        locationKey(unplaced),
      ]);
      expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(['1', '3']);
    });

    it('puts unplaced rows after the placed ones whatever their rank', () => {
      const big = location({ city: 'Nowhere', lat: null, lon: null, count: 999 });
      renderList({ locations: [big, trenton], bounds: east });
      const rows = screen.getAllByRole('button');
      expect(rows.map((row) => row.dataset.key)).toEqual([locationKey(trenton), locationKey(big)]);
      expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(['2', '1']);
    });

    it('reads the rows listed against all locations in the header while some are out of view', () => {
      renderList({ locations: [trenton, boise, unplaced], bounds: east });
      expect(screen.getByText('map.inViewCount:2,3')).toBeInTheDocument();
    });

    it('keeps the header as it is when every location is in view', () => {
      renderList({ bounds: { west: -180, south: -85, east: 180, north: 85 } });
      expect(screen.queryByText(/map\.inViewCount/)).not.toBeInTheDocument();
      expect(screen.getByText('map.byStreams')).toBeInTheDocument();
    });

    it('wraps across the antimeridian when west is past east', () => {
      const fiji = location({ city: 'Suva', lat: -18.1, lon: 178.4 });
      const samoa = location({ city: 'Apia', lat: -13.8, lon: -171.8 });
      renderList({
        locations: [fiji, samoa, trenton],
        bounds: { west: 170, south: -30, east: -165, north: 0 },
      });
      expect(screen.getAllByRole('button').map((row) => row.dataset.key)).toEqual([
        locationKey(fiji),
        locationKey(samoa),
      ]);
    });

    it('offers to show all when no placed location is in view', async () => {
      const onShowAll = vi.fn();
      renderList({
        locations: [boise, unplaced],
        bounds: east,
        onShowAll,
      });
      expect(screen.getByText('map.noneInView')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ewing/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'map.showAll' }));
      expect(onShowAll).toHaveBeenCalledTimes(1);
    });
  });
});
