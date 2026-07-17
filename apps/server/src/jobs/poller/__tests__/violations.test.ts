/**
 * Violations Module Tests
 *
 * Tests rule/violation functions from poller/violations.ts:
 * - getTrustScorePenalty: Map violation severity to trust score penalty
 * - doesRuleApplyToUser: Check if a rule applies to a specific user
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getTrustScorePenalty, doesRuleApplyToUser } from '../violations.js';

describe('getTrustScorePenalty', () => {
  describe('severity mapping', () => {
    it('should return 20 for HIGH severity', () => {
      expect(getTrustScorePenalty('high')).toBe(20);
    });

    it('should return 10 for WARNING severity', () => {
      expect(getTrustScorePenalty('warning')).toBe(10);
    });

    it('should return 5 for LOW severity', () => {
      expect(getTrustScorePenalty('low')).toBe(5);
    });
  });
});

describe('doesRuleApplyToUser', () => {
  describe('global rules', () => {
    it('should apply global rules (serverUserId=null) to any user', () => {
      const globalRule = { serverUserId: null };
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
      expect(doesRuleApplyToUser(globalRule, randomUUID())).toBe(true);
    });
  });

  describe('user-specific rules', () => {
    it('should apply user-specific rule only to that user', () => {
      const targetServerUserId = randomUUID();
      const otherServerUserId = randomUUID();
      const userRule = { serverUserId: targetServerUserId };

      expect(doesRuleApplyToUser(userRule, targetServerUserId)).toBe(true);
      expect(doesRuleApplyToUser(userRule, otherServerUserId)).toBe(false);
    });
  });

  describe('identity (person)-scoped rules', () => {
    it('applies to any server user whose identity matches userId', () => {
      const identityId = randomUUID();
      const personRule = { serverUserId: null, userId: identityId };

      expect(doesRuleApplyToUser(personRule, randomUUID(), identityId)).toBe(true);
    });

    it('does not apply when the server user belongs to a different identity', () => {
      const identityId = randomUUID();
      const otherIdentityId = randomUUID();
      const personRule = { serverUserId: null, userId: identityId };

      expect(doesRuleApplyToUser(personRule, randomUUID(), otherIdentityId)).toBe(false);
    });

    it('does not apply when no identity is known for the server user', () => {
      const identityId = randomUUID();
      const personRule = { serverUserId: null, userId: identityId };

      expect(doesRuleApplyToUser(personRule, randomUUID())).toBe(false);
    });

    it('takes priority over serverUserId when both happen to be set', () => {
      const identityId = randomUUID();
      const serverUserId = randomUUID();
      const otherServerUserId = randomUUID();
      const mixedRule = { serverUserId, userId: identityId };

      // Different account, but same identity - still applies via userId.
      expect(doesRuleApplyToUser(mixedRule, otherServerUserId, identityId)).toBe(true);
    });
  });
});
