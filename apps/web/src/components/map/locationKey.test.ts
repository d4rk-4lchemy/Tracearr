import { describe, expect, it } from 'vitest';
import type { LocationStats } from '@tracearr/shared';
import { locationHistoryFilters, locationHistoryParams } from './locationKey';

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

describe('locationHistoryParams', () => {
  it('writes every filter that reproduces the location and keeps the range keys', () => {
    const zurich = location({ city: 'Zürich', region: 'Rhône-Alpes & Co', country: 'CH' });
    const params = locationHistoryParams(zurich, {
      serverIds: ['server-a', 'server-b'],
      serverUserIds: ['su-1', 'su-2'],
      mediaType: 'episode',
      range: new URLSearchParams('period=custom&from=2026-10-01&to=2026-10-11&view=heatmap'),
    });

    const read = new URLSearchParams(params.toString());
    expect(read.get('countries')).toBe('CH');
    expect(read.get('city')).toBe('Zürich');
    expect(read.get('region')).toBe('Rhône-Alpes & Co');
    expect(read.get('network')).toBe('remote');
    expect(read.get('serverIds')).toBe('server-a,server-b');
    expect(read.get('userIds')).toBe('su-1,su-2');
    expect(read.get('mediaTypes')).toBe('episode');
    expect(read.get('period')).toBe('custom');
    expect(read.get('from')).toBe('2026-10-01');
    expect(read.get('to')).toBe('2026-10-11');
    expect(read.has('view')).toBe(false);
    expect(read.has('noCity')).toBe(false);
    expect(read.has('noRegion')).toBe(false);
  });

  it('marks a missing city and region instead of leaving them open', () => {
    const germany = location({ city: null, region: null, country: 'DE' });
    const params = locationHistoryParams(germany, { range: new URLSearchParams() });

    expect(params.get('noCity')).toBe('true');
    expect(params.get('noRegion')).toBe('true');
    expect(params.has('city')).toBe(false);
    expect(params.has('region')).toBe(false);
    expect(params.has('period')).toBe(false);
  });

  it('writes network=local for a local location', () => {
    const params = locationHistoryParams(location({ isLocal: true }), {
      range: new URLSearchParams(),
    });
    expect(params.get('network')).toBe('local');
  });
});

describe('locationHistoryFilters', () => {
  it('treats an empty-string city as a name, not as missing', () => {
    expect(locationHistoryFilters(location({ city: '', region: null }))).toEqual({
      geoCountries: ['US'],
      geoCity: '',
      geoRegionMissing: true,
      network: 'remote',
    });
  });
});
