// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { imageProxyUrl } from './basePath';

describe('imageProxyUrl', () => {
  it('proxies absolute Dispatcharr image URLs through the image proxy endpoint', () => {
    const url = imageProxyUrl(
      'server-1',
      'https://dispatcharr.example.com/api/channels/logos/4671/cache/?ts=123#ignored',
      200,
      300,
      'poster'
    );

    expect(url).toBe(
      '/api/v1/images/proxy?server=server-1&url=https%3A%2F%2Fdispatcharr.example.com%2Fapi%2Fchannels%2Flogos%2F4671%2Fcache%2F%3Fts%3D123%23ignored&width=200&height=300&fallback=poster'
    );
  });
});
