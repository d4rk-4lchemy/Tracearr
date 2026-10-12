/**
 * JWT Utility Tests
 *
 * Tests the ACTUAL exported functions from jwt.ts:
 * - verifyJwt: Verify JWT tokens and extract user payload
 *
 * These tests validate:
 * - Valid token verification
 * - Expired token handling
 * - Invalid signature detection
 * - Malformed payload handling
 * - Missing JWT_SECRET handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Import ACTUAL production functions and types - not local duplicates
import { verifyJwt, type JwtVerifyResult, type JwtVerifyError } from '../jwt.js';

const TEST_SECRET = 'test-jwt-secret-for-testing-only';
const DIFFERENT_SECRET = 'different-secret-that-wont-work';

// Valid user payload matching AuthUser interface
const VALID_USER_PAYLOAD = {
  userId: 'user-123',
  username: 'testuser',
  role: 'admin' as const,
  serverIds: ['server-1', 'server-2'],
};

describe('jwt', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe('verifyJwt', () => {
    describe('valid tokens', () => {
      it('should verify a valid token and return user data', () => {
        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
          expiresIn: '1h',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(true);
        const successResult = result as JwtVerifyResult;
        expect(successResult.user.userId).toBe('user-123');
        expect(successResult.user.username).toBe('testuser');
        expect(successResult.user.role).toBe('admin');
        expect(successResult.user.serverIds).toEqual(['server-1', 'server-2']);
      });

      it('should handle token without serverIds (defaults to empty array)', () => {
        const payloadWithoutServerIds = {
          userId: 'user-456',
          username: 'anotheruser',
          role: 'user' as const,
          // No serverIds
        };

        const token = jwt.sign(payloadWithoutServerIds, TEST_SECRET, {
          algorithm: 'HS256',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(true);
        const successResult = result as JwtVerifyResult;
        expect(successResult.user.serverIds).toEqual([]);
      });

      it('should verify token with member role', () => {
        const memberPayload = {
          userId: 'user-789',
          username: 'member',
          role: 'member' as const,
          serverIds: [],
        };

        const token = jwt.sign(memberPayload, TEST_SECRET, { algorithm: 'HS256' });

        const result = verifyJwt(token);

        expect(result.valid).toBe(true);
        const successResult = result as JwtVerifyResult;
        expect(successResult.user.role).toBe('member');
      });
    });

    describe('expired tokens', () => {
      it('should return error for expired token', () => {
        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
          expiresIn: '-1s', // Already expired
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Token expired');
      });

      it('should return error for token that expired long ago', () => {
        // Create a token that expired an hour ago
        const token = jwt.sign(
          { ...VALID_USER_PAYLOAD, iat: Math.floor(Date.now() / 1000) - 7200 },
          TEST_SECRET,
          { algorithm: 'HS256', expiresIn: '1h' }
        );

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Token expired');
      });
    });

    describe('invalid tokens', () => {
      it('should return error for token signed with wrong secret', () => {
        const token = jwt.sign(VALID_USER_PAYLOAD, DIFFERENT_SECRET, {
          algorithm: 'HS256',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token');
      });

      it('should return error for malformed token', () => {
        const result = verifyJwt('not.a.valid.jwt.token');

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token');
      });

      it('should return error for empty string token', () => {
        const result = verifyJwt('');

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token');
      });

      it('should return error for token with wrong algorithm', () => {
        // Sign with HS384 but verifyJwt only accepts HS256
        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS384',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token');
      });

      it('should return error for tampered token', () => {
        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
        });

        // Tamper with the payload part
        const parts = token.split('.');
        parts[1] = Buffer.from(JSON.stringify({ ...VALID_USER_PAYLOAD, role: 'admin' }))
          .toString('base64')
          .replace(/=/g, '');
        const tamperedToken = parts.join('.');

        const result = verifyJwt(tamperedToken);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token');
      });
    });

    describe('invalid payload', () => {
      it('should return error when userId is missing', () => {
        const invalidPayload = {
          username: 'testuser',
          role: 'admin',
        };

        const token = jwt.sign(invalidPayload, TEST_SECRET, { algorithm: 'HS256' });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token payload');
      });

      it('should return error when username is missing', () => {
        const invalidPayload = {
          userId: 'user-123',
          role: 'admin',
        };

        const token = jwt.sign(invalidPayload, TEST_SECRET, { algorithm: 'HS256' });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token payload');
      });

      it('should return error when role is missing', () => {
        const invalidPayload = {
          userId: 'user-123',
          username: 'testuser',
        };

        const token = jwt.sign(invalidPayload, TEST_SECRET, { algorithm: 'HS256' });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token payload');
      });

      it('should return error for completely empty payload', () => {
        const token = jwt.sign({}, TEST_SECRET, { algorithm: 'HS256' });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('Invalid token payload');
      });
    });

    describe('missing JWT_SECRET', () => {
      it('should return error when JWT_SECRET is not configured', () => {
        delete process.env.JWT_SECRET;

        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('JWT_SECRET not configured');
      });

      it('should return error when JWT_SECRET is empty string', () => {
        process.env.JWT_SECRET = '';

        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
        });

        const result = verifyJwt(token);

        expect(result.valid).toBe(false);
        const errorResult = result as JwtVerifyError;
        expect(errorResult.error).toBe('JWT_SECRET not configured');
      });
    });

    describe('real-world scenarios', () => {
      it('should work with WebSocket authentication flow', () => {
        // Simulate: Client sends token in connection params
        const token = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
          expiresIn: '7d',
        });

        // Server verifies token
        const result = verifyJwt(token);

        expect(result.valid).toBe(true);
        const successResult = result as JwtVerifyResult;

        // Server can now use user data for authorization
        expect(successResult.user.userId).toBe('user-123');
        expect(successResult.user.serverIds).toContain('server-1');
      });

      it('should handle token refresh scenario', () => {
        // Original token about to expire
        const oldToken = jwt.sign(VALID_USER_PAYLOAD, TEST_SECRET, {
          algorithm: 'HS256',
          expiresIn: '1m',
        });

        const result = verifyJwt(oldToken);
        expect(result.valid).toBe(true);

        // In a real scenario, server would issue new token
        // This test just verifies the old token is still valid
      });
    });
  });
});
