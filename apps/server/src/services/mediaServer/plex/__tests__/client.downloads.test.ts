import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as HttpModule from '../../../../utils/http.js';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('../../../../utils/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  fetchJson: vi.fn(),
  plexHeaders: vi.fn().mockReturnValue({ 'X-Plex-Token': 'test-token' }),
}));
vi.mock('../../../../lib/redisShared.js', () => ({
  getRedis: () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => store.set(key, value),
  }),
}));

import { fetchJson } from '../../../../utils/http.js';
import { PlexClient } from '../client.js';

const mockFetchJson = vi.mocked(fetchJson);

const DEVICE = 'o2wsbz6wagpn4g7e8g9kqge9';

const metadata = {
  MediaContainer: {
    Metadata: [
      {
        Media: [
          {
            id: 110988,
            videoResolution: '1080',
            videoCodec: 'h264',
            audioCodec: 'eac3',
            Part: [{ id: 111093, size: 3181199596, container: 'mkv' }],
          },
        ],
      },
    ],
  },
};

const devices = {
  MediaContainer: {
    Device: [
      { id: 3, name: 'iPhone', platform: 'iOS', product: 'Plex for iOS', clientIdentifier: DEVICE },
    ],
  },
};

function respond(routes: { metadata?: unknown; devices?: unknown }) {
  mockFetchJson.mockImplementation(async (url) => {
    const route = String(url).endsWith('/devices') ? routes.devices : routes.metadata;
    if (route instanceof Error) throw route;
    return route;
  });
}

function makeClient() {
  return new PlexClient({ url: 'http://plex.local:32400', token: 't', id: 'server-1' });
}

const request = { itemKey: '181284', partId: '111093', userId: '1', app: null, device: null };

beforeEach(() => {
  mockFetchJson.mockReset();
  store.clear();
});

describe('PlexClient describeDownloadSource', () => {
  it('describes the part as delivered and names the app download device', async () => {
    respond({ metadata, devices });

    const result = await makeClient().describeDownloadSource({ ...request, deviceId: DEVICE });

    expect(result).toEqual({
      version: expect.objectContaining({ key: '110988', size: 3181199596, videoCodec: 'H264' }),
      delivered: {
        bytes: 3181199596,
        videoCodec: 'H264',
        audioCodec: 'EAC3',
        container: 'mkv',
        bitrateKbps: null,
        resolution: null,
      },
      device: {
        deviceId: DEVICE,
        playerName: 'iPhone',
        product: 'Plex for iOS',
        platform: 'iOS',
      },
      ipAddress: null,
    });
  });

  it('skips the device lookup for a web download and keeps the part when /devices fails', async () => {
    respond({ metadata, devices: new Error('timeout') });
    const client = makeClient();

    const web = await client.describeDownloadSource({ ...request, deviceId: null });
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(web.device.playerName).toBeNull();

    const failed = await client.describeDownloadSource({ ...request, deviceId: DEVICE });
    expect(failed.version?.key).toBe('110988');
    expect(failed.device).toEqual({
      deviceId: DEVICE,
      playerName: null,
      product: null,
      platform: null,
    });
  });

  it('caches a device missing from /devices so the list is not refetched', async () => {
    respond({ devices: { MediaContainer: { Device: [] } } });
    const client = makeClient();

    expect(await client.getDevice('unknown')).toBeNull();
    expect(await client.getDevice('unknown')).toBeNull();
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});
