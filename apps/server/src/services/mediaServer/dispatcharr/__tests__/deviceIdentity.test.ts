import { describe, expect, it } from 'vitest';
import { dispatcharrDeviceId, dispatcharrUserAgent, deviceIdentity } from '../deviceIdentity.js';
import { buildCompositeKey } from '../../../../jobs/poller/stateTracker.js';

const source = { serverId: 'server-1', serverUserId: 'account-1', dispatcharrUserAgent: 'VLC/3.0' };

describe('Dispatcharr device identity', () => {
  it('ignores IP, connection, media and playback kind, but retains account/server/agent boundaries', () => {
    const first = { ...source, ipAddress: '1.1.1.1', deviceId: 'client-1', ratingKey: 'channel-a' };
    const second = { ...source, ipAddress: '8.8.8.8', deviceId: 'client-2', ratingKey: 'movie-b' };
    expect(dispatcharrDeviceId(first)).toBe(dispatcharrDeviceId(second));
    for (const change of [
      { serverId: 'server-2' },
      { serverUserId: 'account-2' },
      { dispatcharrUserAgent: 'VLC/3.1' },
      { dispatcharrUserAgent: 'vlc/3.0' },
    ])
      expect(dispatcharrDeviceId({ ...source, ...change })).not.toBe(dispatcharrDeviceId(source));
  });

  it('trims only outer whitespace and preserves full agents beyond display-field limits', () => {
    expect(dispatcharrDeviceId({ ...source, dispatcharrUserAgent: '\ufeff VLC/3.0 \t' })).toBe(
      dispatcharrDeviceId(source)
    );
    expect(dispatcharrDeviceId({ ...source, dispatcharrUserAgent: 'VLC/ 3.0' })).not.toBe(
      dispatcharrDeviceId(source)
    );
    const prefix = 'a'.repeat(255);
    expect(dispatcharrDeviceId({ ...source, dispatcharrUserAgent: prefix + '1' })).not.toBe(
      dispatcharrDeviceId({ ...source, dispatcharrUserAgent: prefix + '2' })
    );
  });

  it('recovers legacy agents and unifies missing agents without confusing new literal values with placeholders', () => {
    expect(
      dispatcharrDeviceId({ ...source, dispatcharrUserAgent: null, product: ' VLC/3.0 ' })
    ).toBe(dispatcharrDeviceId(source));
    expect(dispatcharrUserAgent({ product: ' ', playerName: 'VLC/3.0' })).toBe('VLC/3.0');
    for (const playerName of [
      'Dispatcharr Client',
      'Dispatcharr VOD Client',
      'Dispatcharr Catch-up Client',
      null,
    ]) {
      expect(dispatcharrUserAgent({ playerName })).toBe('');
    }
    expect(dispatcharrUserAgent({ dispatcharrUserAgent: '', product: 'stale' })).toBe('');
    expect(dispatcharrUserAgent({ dispatcharrUserAgent: 'Dispatcharr Client' })).toBe(
      'Dispatcharr Client'
    );
  });

  it('keeps simultaneous connections distinct even when both have the same stable device', () => {
    const common = {
      serverType: 'dispatcharr' as const,
      serverId: source.serverId,
      externalUserId: source.serverUserId,
      ratingKey: 'same-channel',
      dispatcharrDeviceId: dispatcharrDeviceId(source),
    };
    const a = { ...common, deviceId: 'client-1', sessionKey: 'channel:client-1' };
    const b = { ...common, deviceId: 'client-2', sessionKey: 'channel:client-2' };
    expect(deviceIdentity(a)).toBe(deviceIdentity(b));
    expect(buildCompositeKey(a)).not.toBe(buildCompositeKey(b));
    expect(deviceIdentity({ deviceId: 'plex-machine' })).toBe('plex-machine');
  });
});
