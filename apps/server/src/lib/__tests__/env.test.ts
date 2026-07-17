import { describe, it, expect, afterEach, vi } from 'vitest';

describe('requireBetterAuthSecret', () => {
  const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalBetterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  // Resolution is memoized at module scope, so each call resets the module
  // registry to observe the env vars currently set.
  async function freshEnv() {
    vi.resetModules();
    return import('../env.js');
  }

  it('returns the explicit secret when set', async () => {
    process.env.BETTER_AUTH_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);
    const { requireBetterAuthSecret, isBetterAuthSecretDerived } = await freshEnv();
    expect(requireBetterAuthSecret()).toBe('a'.repeat(32));
    expect(isBetterAuthSecretDerived()).toBe(false);
  });

  it('derives deterministically from JWT_SECRET when unset', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.JWT_SECRET = 'same-jwt-secret-value';
    const { requireBetterAuthSecret: first } = await freshEnv();
    const { requireBetterAuthSecret: second } = await freshEnv();
    expect(first()).toBe(second());
  });

  it('marks the resolved secret as derived when falling back to JWT_SECRET', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.JWT_SECRET = 'some-jwt-secret-value';
    const { isBetterAuthSecretDerived } = await freshEnv();
    expect(isBetterAuthSecretDerived()).toBe(true);
  });

  it('derives a different value for a different JWT_SECRET', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.JWT_SECRET = 'jwt-secret-one';
    const { requireBetterAuthSecret: firstSecret } = await freshEnv();
    const first = firstSecret();

    process.env.JWT_SECRET = 'jwt-secret-two';
    const { requireBetterAuthSecret: secondSecret } = await freshEnv();
    const second = secondSecret();

    expect(first).not.toBe(second);
  });

  it('throws when neither BETTER_AUTH_SECRET nor JWT_SECRET is set', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.JWT_SECRET;
    const { requireBetterAuthSecret } = await freshEnv();
    expect(() => requireBetterAuthSecret()).toThrow('BETTER_AUTH_SECRET');
  });

  // Golden vector pinning the derivation formula:
  // hkdfSync('sha256', ikm, '', 'tracearr-better-auth-secret-v1', 32).
  // Changing this expected value logs out every install that is relying on
  // derivation - it must never change unintentionally.
  it('derives a known, pinned secret for a fixed JWT_SECRET (golden vector)', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.JWT_SECRET = 'scratch-jwt-secret-for-live-verify-32chars';
    const { requireBetterAuthSecret } = await freshEnv();
    expect(requireBetterAuthSecret()).toBe(
      '8bafd9523aa7d38bcceccd5bc5659febb3b9126863166700cd6d6f951537743a'
    );
  });
});
