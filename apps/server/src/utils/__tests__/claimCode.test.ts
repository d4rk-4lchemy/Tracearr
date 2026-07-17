/**
 * Claim Code Utility Tests
 *
 * Tests claim code generation, validation, and initialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializeClaimCode,
  validateClaimCode,
  getClaimCode,
  resetClaimCode,
  isClaimCodeEnabled,
} from '../claimCode.js';

describe('Claim Code Utility', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original env
    originalEnv = process.env.CLAIM_CODE;
    // Reset claim code state
    resetClaimCode();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.CLAIM_CODE = originalEnv;
    } else {
      delete process.env.CLAIM_CODE;
    }
    // Reset claim code state
    resetClaimCode();
  });

  describe('initializeClaimCode', () => {
    it('does not enable claim code if env var not set', () => {
      delete process.env.CLAIM_CODE;

      initializeClaimCode();

      expect(isClaimCodeEnabled()).toBe(false);
      expect(getClaimCode()).toBeNull();
    });

    it('enables claim code and uses CLAIM_CODE from environment if set', () => {
      process.env.CLAIM_CODE = 'TEST-CODE-1234';

      initializeClaimCode();

      expect(isClaimCodeEnabled()).toBe(true);
      const code = getClaimCode();
      expect(code).toBe('TEST-CODE-1234');
    });

    it('normalizes env claim code to uppercase', () => {
      process.env.CLAIM_CODE = 'test-code-1234';

      initializeClaimCode();

      const code = getClaimCode();
      expect(code).toBe('TEST-CODE-1234');
    });

    it('trims whitespace from env claim code', () => {
      process.env.CLAIM_CODE = '  TEST-CODE-1234  ';

      initializeClaimCode();

      const code = getClaimCode();
      expect(code).toBe('TEST-CODE-1234');
    });

    it('does not reinitialize if already initialized', () => {
      process.env.CLAIM_CODE = 'FIRST-CODE-1234';
      initializeClaimCode();
      const firstCode = getClaimCode();

      process.env.CLAIM_CODE = 'SECOND-CODE-5678';
      initializeClaimCode();
      const secondCode = getClaimCode();

      expect(firstCode).toBe('FIRST-CODE-1234');
      expect(secondCode).toBe('FIRST-CODE-1234'); // Should not change
    });
  });

  describe('isClaimCodeEnabled', () => {
    it('returns false when not initialized', () => {
      expect(isClaimCodeEnabled()).toBe(false);
    });

    it('returns false when env var not set', () => {
      delete process.env.CLAIM_CODE;
      initializeClaimCode();
      expect(isClaimCodeEnabled()).toBe(false);
    });

    it('returns true when env var is set', () => {
      process.env.CLAIM_CODE = 'TEST-CODE-1234';
      initializeClaimCode();
      expect(isClaimCodeEnabled()).toBe(true);
    });
  });

  describe('validateClaimCode', () => {
    describe('when claim code is enabled', () => {
      beforeEach(() => {
        process.env.CLAIM_CODE = 'ABCD-EFGH-JKLM';
        initializeClaimCode();
      });

      it('validates correct claim code', () => {
        expect(validateClaimCode('ABCD-EFGH-JKLM')).toBe(true);
      });

      it('validates claim code without dashes', () => {
        expect(validateClaimCode('ABCDEFGHJKLM')).toBe(true);
      });

      it('validates claim code with different case', () => {
        expect(validateClaimCode('abcd-efgh-jklm')).toBe(true);
        expect(validateClaimCode('aBcD-EfGh-JkLm')).toBe(true);
      });

      it('validates claim code with extra whitespace', () => {
        expect(validateClaimCode('  ABCD-EFGH-JKLM  ')).toBe(true);
        expect(validateClaimCode(' ABCDEFGHJKLM ')).toBe(true);
      });

      it('rejects incorrect claim code', () => {
        expect(validateClaimCode('WRONG-CODE-9999')).toBe(false);
      });

      it('rejects empty string', () => {
        expect(validateClaimCode('')).toBe(false);
      });

      it('rejects null', () => {
        expect(validateClaimCode(null)).toBe(false);
      });

      it('rejects undefined', () => {
        expect(validateClaimCode(undefined)).toBe(false);
      });

      it('rejects partially correct code', () => {
        expect(validateClaimCode('ABCD-EFGH-XXXX')).toBe(false);
      });

      it('rejects a code of a different length without throwing', () => {
        expect(() => validateClaimCode('SHORT')).not.toThrow();
        expect(validateClaimCode('SHORT')).toBe(false);
        expect(() => validateClaimCode('WAY-TOO-LONG-A-CODE-THAT-DOES-NOT-MATCH')).not.toThrow();
        expect(validateClaimCode('WAY-TOO-LONG-A-CODE-THAT-DOES-NOT-MATCH')).toBe(false);
      });
    });

    describe('when claim code is disabled', () => {
      beforeEach(() => {
        delete process.env.CLAIM_CODE;
        initializeClaimCode();
      });

      it('always returns true regardless of input', () => {
        expect(validateClaimCode('WRONG-CODE')).toBe(true);
        expect(validateClaimCode('ABCD-EFGH-JKLM')).toBe(true);
        expect(validateClaimCode('')).toBe(true);
        expect(validateClaimCode(null)).toBe(true);
        expect(validateClaimCode(undefined)).toBe(true);
      });
    });
  });

  describe('getClaimCode', () => {
    it('returns null if not initialized', () => {
      expect(getClaimCode()).toBeNull();
    });

    it('returns null if claim code disabled', () => {
      delete process.env.CLAIM_CODE;
      initializeClaimCode();
      expect(getClaimCode()).toBeNull();
    });

    it('returns the initialized claim code when enabled', () => {
      process.env.CLAIM_CODE = 'TEST-CODE-1234';
      initializeClaimCode();
      expect(getClaimCode()).toBe('TEST-CODE-1234');
    });
  });

  describe('resetClaimCode', () => {
    it('resets the claim code and enabled flag', () => {
      process.env.CLAIM_CODE = 'TEST-CODE-1234';
      initializeClaimCode();
      expect(getClaimCode()).toBe('TEST-CODE-1234');
      expect(isClaimCodeEnabled()).toBe(true);

      resetClaimCode();
      expect(getClaimCode()).toBeNull();
      expect(isClaimCodeEnabled()).toBe(false);
    });
  });
});
