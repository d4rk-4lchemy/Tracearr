import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LocationStats, LocationUserInfo } from '@tracearr/shared';
import { AreaPanel } from './AreaPanel';
import { locationKey } from './locationKey';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${Object.values(options).join(',')}`,
  }),
}));

function person(id: string, count: number, serverUserIds = [id]): LocationUserInfo {
  return {
    id,
    username: id,
    identityName: null,
    thumbUrl: null,
    serverId: 'server-1',
    serverUserIds,
    count,
  };
}

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

const trenton = location({
  count: 12,
  users: [person('alice-rep', 8, ['alice-rep', 'alice-jf']), person('bob', 4)],
});
const ewing = location({
  city: 'Ewing',
  lat: 40.27,
  lon: -74.8,
  count: 9,
  users: [person('carol', 6), person('alice-jf', 3, ['alice-rep', 'alice-jf'])],
});
const ewingTwp = location({ city: 'Ewing Township', lat: 40.27, lon: -74.8, count: 2 });

function renderPanel(places = [ewingTwp, trenton, ewing]) {
  const onBack = vi.fn();
  const onSelectPlace = vi.fn();
  const onSelectPerson = vi.fn();
  render(
    <AreaPanel
      places={places}
      onBack={onBack}
      onSelectPlace={onSelectPlace}
      onSelectPerson={onSelectPerson}
    />
  );
  return { onBack, onSelectPlace, onSelectPerson };
}

describe('AreaPanel', () => {
  it('names the area after its largest place and totals its places and streams', () => {
    renderPanel();
    const heading = screen.getByRole('heading', { name: 'map.areaName:Trenton' });
    expect(heading.parentElement).toHaveTextContent(
      /^map\.areaName:Trentonmap\.streamsAcrossPlaces:23,3$/
    );
  });

  it('lists every place largest first, including two on one coordinate, and opens a clicked one', async () => {
    const { onSelectPlace } = renderPanel();
    const rows = within(screen.getByTestId('area-places')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Trenton'),
      expect.stringContaining('Ewing'),
      expect.stringContaining('Ewing Township'),
    ]);
    const [first] = rows;
    if (!first) throw new Error('missing rows');
    expect(within(first).getByText('map.streamCount:12')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ewing Township/ }));
    expect(onSelectPlace).toHaveBeenCalledWith(locationKey(ewingTwp));
  });

  it('merges people across places by account overlap and orders them by summed count', async () => {
    const { onSelectPerson } = renderPanel();
    const rows = within(screen.getByTestId('area-people')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Aalice-repmap.streamCount:11',
      'Ccarolmap.streamCount:6',
      'Bbobmap.streamCount:4',
    ]);

    const [alice] = rows;
    if (!alice) throw new Error('missing rows');
    await userEvent.click(alice);
    expect(onSelectPerson).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alice-rep', serverUserIds: ['alice-rep', 'alice-jf'] })
    );
  });

  it('has no History link', () => {
    renderPanel();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('goes back on the back button and on Escape', async () => {
    const { onBack } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /map\.allLocations/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the heading when it opens', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'map.areaName:Trenton' })).toHaveFocus();
  });
});
