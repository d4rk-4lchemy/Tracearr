import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.js', () => ({ db: { select: vi.fn(), update: vi.fn() } }));
vi.mock('../plexGeoip.js', () => ({ lookupGeoIP: vi.fn() }));

import { db } from '../../db/client.js';
import { lookupGeoIP } from '../plexGeoip.js';
import type { GeoLocation } from '../geoip.js';
import {
  locationAt,
  locationRanges,
  placeLocal,
  type ServerLocation,
} from '../serverLocationRanges.js';
import {
  markImportedServerLocations,
  resolveSessionGeo,
  withLocalFlag,
} from '../serverLocations.js';

const CHICAGO: ServerLocation = {
  effectiveFrom: null,
  lat: 41.8781,
  lon: -87.6298,
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
};
const DENVER: ServerLocation = {
  effectiveFrom: new Date('2024-03-01T06:00:00Z'),
  lat: 39.7392,
  lon: -104.9903,
  city: 'Denver',
  region: 'Colorado',
  country: 'US',
};
const LOCAL_GEO: GeoLocation = {
  city: null,
  region: null,
  country: 'Local Network',
  countryCode: null,
  continent: null,
  postal: null,
  lat: null,
  lon: null,
  asnNumber: null,
  asnOrganization: null,
};

function mockEntries(rows: ServerLocation[]) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({ where: () => Promise.resolve(rows) }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('locationRanges', () => {
  it('is one unplaced range over all time with no entries', () => {
    expect(locationRanges([])).toEqual([{ from: null, to: null, location: null }]);
  });

  it('leaves time before a dated first entry unplaced', () => {
    expect(locationRanges([DENVER])).toEqual([
      { from: null, to: DENVER.effectiveFrom, location: null },
      { from: DENVER.effectiveFrom, to: null, location: DENVER },
    ]);
  });

  it('orders entries by start regardless of input order', () => {
    const ranges = locationRanges([DENVER, CHICAGO]);
    expect(ranges.map((range) => range.location?.city)).toEqual(['Chicago', 'Denver']);
    expect(ranges[0]?.to).toEqual(DENVER.effectiveFrom);
  });
});

describe('locationAt', () => {
  it('uses the undated entry before the first move and the move from its start instant', () => {
    const entries = [CHICAGO, DENVER];
    expect(locationAt(entries, new Date('2024-02-29T23:59:59Z'))?.city).toBe('Chicago');
    expect(locationAt(entries, new Date('2024-03-01T06:00:00Z'))?.city).toBe('Denver');
  });

  it('is null before a dated first entry', () => {
    expect(locationAt([DENVER], new Date('2023-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('placeLocal', () => {
  it('leaves the Local Network label alone with no location', () => {
    expect(placeLocal(LOCAL_GEO, null)).toBe(LOCAL_GEO);
  });

  it('writes the entry and clears continent and postal', () => {
    const placed = placeLocal({ ...LOCAL_GEO, continent: 'NA', postal: '60601' }, CHICAGO);
    expect(placed).toMatchObject({
      city: 'Chicago',
      region: 'Illinois',
      country: 'US',
      countryCode: 'US',
      lat: 41.8781,
      lon: -87.6298,
      continent: null,
      postal: null,
    });
  });
});

describe('resolveSessionGeo', () => {
  it('does not read locations for a public IP', async () => {
    vi.mocked(lookupGeoIP).mockResolvedValue({ ...LOCAL_GEO, country: 'US', countryCode: 'US' });
    const geo = await resolveSessionGeo('8.8.8.8', 'server-1', false);
    expect(geo.isLocal).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('places a private IP at the entry in effect', async () => {
    vi.mocked(lookupGeoIP).mockResolvedValue(LOCAL_GEO);
    mockEntries([CHICAGO]);
    const geo = await resolveSessionGeo('192.168.1.20', 'server-1', false);
    expect(geo).toMatchObject({ isLocal: true, city: 'Chicago', countryCode: 'US', lat: 41.8781 });
  });

  it('keeps the Local Network label when the server has no location', async () => {
    vi.mocked(lookupGeoIP).mockResolvedValue(LOCAL_GEO);
    mockEntries([]);
    const geo = await resolveSessionGeo('10.0.0.5', 'server-1', false);
    expect(geo).toMatchObject({ isLocal: true, country: 'Local Network', lat: null });
  });
});

describe('withLocalFlag', () => {
  it('derives the flag from the IP when an older pending entry lacks it', () => {
    expect(withLocalFlag(LOCAL_GEO, '192.168.1.20').isLocal).toBe(true);
    expect(withLocalFlag({ ...LOCAL_GEO, isLocal: false }, '192.168.1.20').isLocal).toBe(false);
  });
});

describe('markImportedServerLocations', () => {
  it('bumps the version only for a server that has a location', async () => {
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    } as never);
    await markImportedServerLocations('server-1');
    expect(db.update).not.toHaveBeenCalled();

    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'loc-1' }]) }) }),
    } as never);
    await markImportedServerLocations('server-1');
    expect(set).toHaveBeenCalledTimes(1);
  });
});
