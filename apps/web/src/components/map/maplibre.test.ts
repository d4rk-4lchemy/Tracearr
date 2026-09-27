import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn(), setWorkerUrl: vi.fn() }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));
vi.mock('pmtiles', () => ({
  PMTiles: class {
    getHeader() {
      return Promise.resolve({ maxZoom: 8 });
    }
  },
  Protocol: class {
    tile = vi.fn();
    add = vi.fn();
  },
}));
vi.mock('@protomaps/basemaps', () => ({ layers: () => [], namedFlavor: () => ({}) }));

import { checkBasemap, HEAT_FADE, mapMaxZoom, readLocationFeature } from './maplibre';

describe('readLocationFeature', () => {
  it('parses the servers array maplibre hands back as a JSON string', () => {
    const props = readLocationFeature({
      w: 1,
      count: 3,
      city: 'Trenton',
      country: 'US',
      isLocal: false,
      serverId: 'a',
      servers: '[{"serverId":"a","count":2},{"serverId":"b","count":1}]',
    });
    expect(props.servers).toEqual([
      { serverId: 'a', count: 2 },
      { serverId: 'b', count: 1 },
    ]);
  });

  it('keeps a missing breakdown as null', () => {
    const props = readLocationFeature({ w: 1, count: 1, isLocal: true });
    expect(props.servers).toBeNull();
    expect(props.city).toBeNull();
  });
});

describe('mapMaxZoom', () => {
  it('allows two levels past the archive once the header is known', async () => {
    await checkBasemap();
    expect(mapMaxZoom()).toBe(10);
  });

  it('never drops below the heat to circle crossfade', () => {
    expect(mapMaxZoom(6)).toBe(HEAT_FADE.end);
  });
});
