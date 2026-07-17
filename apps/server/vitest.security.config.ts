/**
 * Security Tests Configuration
 *
 * Authentication and authorization tests:
 * - Token validation and bypass attempts
 * - Privilege escalation prevention
 * - Role-based access control
 *
 * These tests verify security behavior, not implementation coverage.
 * No coverage thresholds - security tests are pass/fail.
 *
 * NOTE: this suite runs without DB/Redis services, so it cannot drive live
 * Better Auth flows. The live auth security gates are
 * test/integration/betterAuthSecurity.integration.test.ts and
 * test/integration/betterAuthProxyOrigin.integration.test.ts, executed by
 * the test-integration CI job (which provides real Postgres/Redis).
 *
 * Run: pnpm test:security
 */

import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from './vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: 'security',
      include: ['src/**/*.security.test.ts'],
      // No coverage for security tests - they test behavior, not implementation
    },
  })
);
