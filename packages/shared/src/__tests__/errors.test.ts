import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../errors.js';
import {
  MIN_MOBILE_CLIENT_VERSION,
  MOBILE_CLIENT_HEADER,
  REDIS_KEYS,
  setRedisPrefix,
} from '../constants.js';

describe('mobile auth errors', () => {
  it('has the four mobile auth codes', () => {
    expect(ErrorCodes.DEVICE_REVOKED).toBe('AUTH_005');
    expect(ErrorCodes.SESSION_INVALIDATED).toBe('AUTH_006');
    expect(ErrorCodes.MOBILE_TOKEN_REQUIRED).toBe('AUTH_007');
    expect(ErrorCodes.CLIENT_TOO_OLD).toBe('AUTH_008');
  });

  it('has no version floor and a lowercase client header', () => {
    expect(MIN_MOBILE_CLIENT_VERSION).toBeNull();
    expect(MOBILE_CLIENT_HEADER).toBe('x-tracearr-client');
  });

  it('keys revoke tombstones by token hash under the redis prefix', () => {
    expect(REDIS_KEYS.MOBILE_REVOKED_TOKEN('abc123')).toBe('tracearr:mobile:revoked:abc123');
    setRedisPrefix('pfx:');
    try {
      expect(REDIS_KEYS.MOBILE_REVOKED_TOKEN('abc123')).toBe('pfx:tracearr:mobile:revoked:abc123');
    } finally {
      setRedisPrefix('');
    }
  });
});
