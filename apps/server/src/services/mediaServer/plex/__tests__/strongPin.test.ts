import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlexClient } from '../client.js';

vi.mock('../../../../utils/http.js', () => ({
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
  plexHeaders: vi.fn().mockReturnValue({ 'X-Plex-Token': 'test-token' }),
}));

import { fetchJson } from '../../../../utils/http.js';

const mockFetchJson = vi.mocked(fetchJson);

const USER_RESPONSE = {
  id: 12345,
  username: 'testuser',
  email: 'test@example.com',
  thumb: 'https://plex.tv/thumb.jpg',
};

beforeEach(() => {
  mockFetchJson.mockReset();
});

describe('PlexClient.checkOAuthPin strong PIN variant', () => {
  it('returns tokenKind legacy and expiresAt null for the current pin response shape', async () => {
    mockFetchJson
      .mockResolvedValueOnce({ authToken: 'legacy-token-abc' })
      .mockResolvedValueOnce(USER_RESPONSE);

    const result = await PlexClient.checkOAuthPin('pin-1');

    expect(result).not.toBeNull();
    expect(result?.token).toBe('legacy-token-abc');
    expect(result?.tokenKind).toBe('legacy');
    expect(result?.expiresAt).toBeNull();
  });

  it('returns tokenKind jwt with a parsed expiry when the pin carries a strong JWT payload', async () => {
    const expiresIn = 7 * 24 * 60 * 60; // 7 days, per the strong PIN variant
    const before = Date.now();

    mockFetchJson
      .mockResolvedValueOnce({
        authToken: null,
        accessToken: 'jwt-access-token',
        refreshToken: 'jwt-refresh-token',
        expiresIn,
      })
      .mockResolvedValueOnce(USER_RESPONSE);

    const result = await PlexClient.checkOAuthPin('pin-2');

    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result?.token).toBe('jwt-access-token');
    expect(result?.tokenKind).toBe('jwt');
    expect(result?.refreshToken).toBe('jwt-refresh-token');
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + expiresIn * 1000);
    expect(result?.expiresAt?.getTime()).toBeLessThanOrEqual(after + expiresIn * 1000);
  });

  it('falls back to legacy when the JWT payload is incomplete', async () => {
    mockFetchJson
      .mockResolvedValueOnce({
        authToken: 'legacy-fallback-token',
        accessToken: 'jwt-access-token',
        // missing refreshToken/expiresIn - malformed strong-variant response
      })
      .mockResolvedValueOnce(USER_RESPONSE);

    const result = await PlexClient.checkOAuthPin('pin-3');

    expect(result).not.toBeNull();
    expect(result?.token).toBe('legacy-fallback-token');
    expect(result?.tokenKind).toBe('legacy');
    expect(result?.expiresAt).toBeNull();
  });

  it('returns null when the pin has neither a legacy nor a strong token yet', async () => {
    mockFetchJson.mockResolvedValueOnce({ authToken: null });

    const result = await PlexClient.checkOAuthPin('pin-4');

    expect(result).toBeNull();
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});
