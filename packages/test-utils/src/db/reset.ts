/**
 * Test database reset utilities
 *
 * Provides fast truncation between test files while preserving schema.
 * Uses TRUNCATE CASCADE for efficient cleanup.
 */

import { executeRawSql, closeTestPool } from './pool.js';

/**
 * Tables to truncate in dependency order (leaf tables first)
 *
 * Keep this list broad. Integration tests share one migrated database across
 * files, and partial cleanup lets state leak between suites through tables
 * not touched by the original "core auth/session" subset. That is especially
 * problematic for TimescaleDB metadata and library history, where leftover
 * rows can make later tests look slow or flaky even when their own fixtures
 * are small.
 */
const TABLES_TO_TRUNCATE = [
  'violations',
  'rule_action_results',
  'notification_preferences',
  'notification_channel_routing',
  'termination_logs',
  'user_merge_audits',
  'mobile_sessions',
  'mobile_tokens',
  'auth_accounts',
  'auth_sessions',
  'auth_verifications',
  'plex_accounts',
  'sessions',
  'library_snapshots',
  'library_items',
  'rules',
  'server_users',
  'servers',
  'users',
  'settings',
  'timescale_metadata',
];

/**
 * Reset the test database between test files
 *
 * Truncates all tables but preserves schema.
 * Fast and efficient for integration tests.
 *
 * Call this in afterEach() to ensure test isolation.
 */
export async function resetTestDb(): Promise<void> {
  try {
    // Use a single TRUNCATE command with CASCADE for efficiency
    await executeRawSql(`TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`);
  } catch (error) {
    // Table might not exist yet if migrations haven't run
    if (error instanceof Error && error.message.includes('does not exist')) {
      console.warn('[Test Reset] Tables do not exist yet, skipping truncation');
      return;
    }
    throw error;
  }
}

/**
 * Full teardown of test database resources
 *
 * Call this in global afterAll() to release connections.
 */
export async function teardownTestDb(): Promise<void> {
  await closeTestPool();
}

/**
 * Clean up specific tables (useful for targeted cleanup)
 */
export async function truncateTables(tables: string[]): Promise<void> {
  if (tables.length === 0) return;

  await executeRawSql(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
