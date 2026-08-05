import { describe, expect, it } from 'vitest';
import { SERVER_CAPABILITIES, supportsMediaLibrary } from '../serverCapabilities.js';

describe('server capabilities', () => {
  it.each([
    ['plex', true], ['jellyfin', true], ['emby', true], ['dispatcharr', false],
  ] as const)('%s media library capability is %s', (type, expected) => {
    expect(SERVER_CAPABILITIES[type].mediaLibrary).toBe(expected);
    expect(supportsMediaLibrary(type)).toBe(expected);
  });
});
