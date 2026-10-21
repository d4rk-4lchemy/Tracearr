import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as HttpModule from '../../../../utils/http.js';

vi.mock('../../../../utils/http.js', async (importActual) => ({
  ...(await importActual<typeof HttpModule>()),
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../../../../utils/http.js';
import { EmbyClient } from '../../emby/client.js';
import { JellyfinClient } from '../../jellyfin/client.js';
import type { DownloadSourceRequest } from '../../types.js';

const mockFetchJson = vi.mocked(fetchJson);

const TARGET = '22D01846-6841-432B-9C71-8CF676E49F0E';
const EMBY_USER = '171eb71d15f048d9bf4757336999d2eb';

const items = {
  Items: [
    {
      Id: '78146',
      MediaSources: [{ Id: 'mediasource_78146', Size: 2653057272, Container: 'mkv' }],
    },
  ],
};

function respond(routes: { items?: unknown; sessions?: unknown[] | Error }) {
  mockFetchJson.mockImplementation(async (url: string) => {
    const route = url.includes('/Sessions') ? routes.sessions : routes.items;
    if (route instanceof Error) throw route;
    return route;
  });
}

function request(overrides: Partial<DownloadSourceRequest> = {}): DownloadSourceRequest {
  return {
    itemKey: '78146',
    partId: null,
    deviceId: null,
    userId: EMBY_USER,
    app: 'Emby for iOS',
    device: 'iPhone',
    ...overrides,
  };
}

const iphone = {
  UserId: EMBY_USER,
  Client: 'Emby for iOS',
  DeviceName: 'iPhone',
  DeviceId: TARGET,
  RemoteEndPoint: '192.168.50.238',
};

beforeEach(() => {
  mockFetchJson.mockReset();
});

describe('describeDownloadSource on jellyfin and emby', () => {
  it('matches an activity entry to the first session of its user, client and device name', async () => {
    const client = new JellyfinClient({ url: 'http://jf.local:8097', token: 't' });
    respond({
      items,
      sessions: [
        { ...iphone, Client: 'Jellyfin Web', DeviceId: 'web' },
        iphone,
        { ...iphone, DeviceId: 'second' },
      ],
    });

    const result = await client.describeDownloadSource(request());

    expect(result).toEqual({
      version: expect.objectContaining({ key: 'mediasource_78146', size: 2653057272 }),
      delivered: {
        bytes: 2653057272,
        videoCodec: null,
        audioCodec: null,
        container: null,
        bitrateKbps: null,
        resolution: null,
      },
      device: { deviceId: TARGET, playerName: 'iPhone', product: 'Emby for iOS', platform: 'iOS' },
      ipAddress: '192.168.50.238',
    });
  });

  it('leaves the device and ip null when no session of that user, client and device exists', async () => {
    const client = new JellyfinClient({ url: 'http://jf.local:8097', token: 't' });
    respond({ items, sessions: [{ ...iphone, UserId: 'someone-else' }] });

    const result = await client.describeDownloadSource(request());

    expect(result.device).toEqual({
      deviceId: null,
      playerName: null,
      product: null,
      platform: null,
    });
    expect(result.ipAddress).toBeNull();
  });

  it('matches a sync target by its device id only, never a same-named device', async () => {
    const client = new EmbyClient({ url: 'http://emby.local:8096', token: 't' });
    respond({ items, sessions: [{ ...iphone, DeviceId: 'other-iphone' }, iphone] });

    const result = await client.describeDownloadSource(request({ deviceId: TARGET }));

    expect(result.device.deviceId).toBe(TARGET);
    expect(result.ipAddress).toBe('192.168.50.238');
  });

  it('names a sync target from its TargetName when its device has no session', async () => {
    const client = new EmbyClient({ url: 'http://emby.local:8096', token: 't' });
    respond({ items, sessions: [{ ...iphone, DeviceId: 'other-iphone' }] });

    const result = await client.describeDownloadSource(request({ deviceId: TARGET }));

    expect(result.device).toEqual({
      deviceId: TARGET,
      playerName: 'iPhone',
      product: 'Emby for iOS',
      platform: 'iOS',
    });
    expect(result.ipAddress).toBeNull();
  });

  it('keeps the session fields when the item lookup fails', async () => {
    const client = new EmbyClient({ url: 'http://emby.local:8096', token: 't' });
    respond({ items: new Error('ECONNRESET'), sessions: [iphone] });

    const result = await client.describeDownloadSource(request());

    expect(result.version).toBeNull();
    expect(result.delivered).toBeNull();
    expect(result.device.deviceId).toBe(TARGET);
    expect(result.ipAddress).toBe('192.168.50.238');
  });
});
