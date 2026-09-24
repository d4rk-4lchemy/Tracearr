import { describe, expect, it } from 'vitest';
import { getDeviceDisplayName } from './utils';

describe('getDeviceDisplayName', () => {
  it('prefers the name the client gave itself', () => {
    expect(
      getDeviceDisplayName({
        playerName: "Emily's Fire TV",
        product: 'Plex for Amazon FireTV',
        device: 'AFTMM',
        platform: 'Fire TV',
      })
    ).toBe("Emily's Fire TV");
  });

  it('falls back to the app and the hardware it runs on', () => {
    expect(
      getDeviceDisplayName({ playerName: null, product: 'Plex for Roku', device: '50S425' })
    ).toBe('Plex for Roku - 50S425');
  });

  it('does not repeat hardware the app name already contains', () => {
    expect(getDeviceDisplayName({ playerName: null, product: 'Plex for iOS', device: 'iOS' })).toBe(
      'Plex for iOS'
    );
  });

  it('falls back to the platform, then to nothing at all', () => {
    expect(getDeviceDisplayName({ platform: 'Roku' })).toBe('Roku');
    expect(getDeviceDisplayName({})).toBeNull();
  });
});
