/**
 * Claim Code Utility
 *
 * Reads a claim code from environment for first-time setup security.
 * The claim code must be provided when creating the first owner account.
 */

import { timingSafeEqual } from 'node:crypto';
import { hashSha256 } from './hash.js';

/**
 * The claim code for this instance
 * Set once during initialization, or null if claim code feature is disabled
 */
let claimCode: string | null = null;

/**
 * Whether the claim code feature is enabled
 * True if CLAIM_CODE env var is set
 */
let claimCodeEnabled = false;

/**
 * Print claim code to console in an ASCII banner
 */
function printClaimCodeBanner(code: string): void {
  const width = 56;
  const border = '═'.repeat(width);
  const blank = ' '.repeat(width);

  // Helper to center text
  const center = (text: string) => {
    const padding = Math.floor((width - text.length) / 2);
    return text.padStart(text.length + padding).padEnd(width);
  };

  console.log('\n');
  console.log(`╔${border}╗`);
  console.log(`║${blank}║`);
  console.log(`║${center('TRACEARR FIRST-TIME SETUP CLAIM CODE')}║`);
  console.log(`║${blank}║`);
  console.log(`║${center('Claim Code:')}║`);
  console.log(`║${blank}║`);
  console.log(`║${center(code)}║`);
  console.log(`║${blank}║`);
  console.log(`║${center('Copy this code to complete first-time setup.')}║`);
  console.log(`║${center('Required when creating the initial admin account.')}║`);
  console.log(`║${blank}║`);
  console.log(`╚${border}╝`);
  console.log('\n');
}

/**
 * Initialize the claim code
 * - Only initializes if CLAIM_CODE env var is set
 * - If set, reads the value and prints banner
 * - If not set, claim code feature is disabled
 *
 * Should be called once during server startup
 */
export function initializeClaimCode(): void {
  if (claimCode !== null) {
    // Already initialized
    return;
  }

  // Try to read from environment variable
  const envCode = process.env.CLAIM_CODE;

  if (envCode && envCode.trim().length > 0) {
    claimCode = envCode.trim().toUpperCase();
    claimCodeEnabled = true;
    console.log('Claim code security enabled for first-time setup');
    printClaimCodeBanner(claimCode);
  } else {
    // Claim code feature is disabled
    claimCodeEnabled = false;
  }
}

/**
 * Check if the claim code feature is enabled
 *
 * @returns true if CLAIM_CODE env var was set, false otherwise
 */
export function isClaimCodeEnabled(): boolean {
  return claimCodeEnabled;
}

/**
 * Validate a provided claim code against the stored code
 *
 * @param providedCode - The code to validate
 * @returns true if the code matches or claim code is disabled, false otherwise
 */
export function validateClaimCode(providedCode: string | undefined | null): boolean {
  // If claim code feature is disabled, always return true
  if (!claimCodeEnabled) {
    return true;
  }

  if (!claimCode) {
    throw new Error('Claim code enabled but not initialized');
  }

  if (!providedCode) {
    return false;
  }

  // Normalize both codes: trim, uppercase, remove any whitespace/dashes
  const normalizedProvided = providedCode.trim().toUpperCase().replace(/[\s-]/g, '');
  const normalizedStored = claimCode.replace(/[\s-]/g, '');

  // Hash first so both sides are fixed-length before the constant-time
  // compare - timingSafeEqual throws on a length mismatch, which itself
  // leaks the length of the real code via a direct === on unequal strings.
  const providedHash = Buffer.from(hashSha256(normalizedProvided));
  const storedHash = Buffer.from(hashSha256(normalizedStored));

  return timingSafeEqual(providedHash, storedHash);
}

/**
 * Get the current claim code (for testing purposes only)
 * @internal
 */
export function getClaimCode(): string | null {
  return claimCode;
}

/**
 * Reset the claim code (for testing purposes only)
 * @internal
 */
export function resetClaimCode(): void {
  claimCode = null;
  claimCodeEnabled = false;
}
