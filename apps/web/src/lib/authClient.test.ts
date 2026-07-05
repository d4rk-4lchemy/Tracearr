import { describe, it, expect } from 'vitest';
import { API_BASE_URL } from './api';

describe('authClient construction', () => {
  it('constructs the real (unmocked) better-auth client without throwing', async () => {
    // better-auth's createAuthClient parses baseURL with `new URL()` at module load time;
    // a relative baseURL throws BetterAuthError("Invalid base URL...") immediately.
    await expect(import('./authClient')).resolves.toBeDefined();
    const { authClient } = await import('./authClient');
    expect(authClient).toBeTruthy();
  });

  it('builds an absolute baseURL ending in the /auth mount path', () => {
    const resolved = new URL(`${API_BASE_URL}/auth`, window.location.origin).toString();

    expect(() => new URL(resolved)).not.toThrow();
    const parsed = new URL(resolved);
    expect(parsed.protocol).toMatch(/^https?:$/);
    expect(parsed.origin).toBe(window.location.origin);
    expect(parsed.pathname.endsWith('/auth')).toBe(true);
  });
});
