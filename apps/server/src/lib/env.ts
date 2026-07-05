import { hkdfSync } from 'node:crypto';

const DERIVATION_INFO = 'tracearr-better-auth-secret-v1';

interface BetterAuthSecretResolution {
  secret: string;
  derived: boolean;
}

let resolved: BetterAuthSecretResolution | null = null;

function resolveBetterAuthSecret(): BetterAuthSecretResolution {
  if (resolved) return resolved;

  const explicit = process.env.BETTER_AUTH_SECRET;
  if (explicit) {
    resolved = { secret: explicit, derived: false };
    return resolved;
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret) {
    const derived = hkdfSync('sha256', jwtSecret, '', DERIVATION_INFO, 32);
    resolved = { secret: Buffer.from(derived).toString('hex'), derived: true };
    return resolved;
  }

  throw new Error(
    'BETTER_AUTH_SECRET environment variable is required. Generate one with: openssl rand -hex 32'
  );
}

/**
 * Returns BETTER_AUTH_SECRET when set, otherwise derives it deterministically
 * from JWT_SECRET (HKDF-SHA256) so upgrading installs don't need a new env
 * var. Every instance sharing the same JWT_SECRET derives the same value,
 * which multi-instance deployments depend on. Throws if neither is set.
 */
export function requireBetterAuthSecret(): string {
  return resolveBetterAuthSecret().secret;
}

/** True when requireBetterAuthSecret() derived its value from JWT_SECRET rather than using an explicit BETTER_AUTH_SECRET. */
export function isBetterAuthSecretDerived(): boolean {
  return resolveBetterAuthSecret().derived;
}
