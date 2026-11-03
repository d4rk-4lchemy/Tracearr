import { describe, expect, it } from 'vitest';
import { channelsDvrArtworkPath, isChannelsDvrItemId } from '../channelsDvr/artwork.js';

const BASE = 'http://channels.local:8089';

describe('Channels DVR artwork paths', () => {
  it('routes TMS poster artwork through the configured Channels DVR server', () => {
    expect(
      channelsDvrArtworkPath(
        BASE,
        'https://tmsimg.fancybits.co/assets/p11642_v_v11_az.jpg?w=480&h=720'
      )
    ).toBe('/tmsimg/assets/p11642_v_v11_az.jpg?w=480&h=720');
  });

  it('routes ebyl.tmsimg.com guide artwork through the Channels DVR image proxy', () => {
    expect(
      channelsDvrArtworkPath(
        BASE,
        'https://ebyl.tmsimg.com/assets/p31385280_b_h9_aa.jpg'
      )
    ).toBe('/tmsimg/assets/p31385280_b_h9_aa.jpg');
  });

  it('accepts local Channels DVR uploaded artwork', () => {
    expect(channelsDvrArtworkPath(BASE, '/dvr/uploads/125/content')).toBe(
      '/dvr/uploads/125/content'
    );
    expect(
      channelsDvrArtworkPath(BASE, 'http://channels.local:8089/dvr/uploads/125/content')
    ).toBe('/dvr/uploads/125/content');
  });

  it.each([
    'https://evil.example/poster.jpg',
    'http://tmsimg.fancybits.co/assets/poster.jpg',
    '/dvr/settings',
  ])(
    'rejects unsupported artwork URL %s',
    (value) => expect(channelsDvrArtworkPath(BASE, value)).toBeNull()
  );

  it('accepts only numeric library item IDs', () => {
    expect(isChannelsDvrItemId('4880')).toBe(true);
    expect(isChannelsDvrItemId('../4880')).toBe(false);
  });
});

