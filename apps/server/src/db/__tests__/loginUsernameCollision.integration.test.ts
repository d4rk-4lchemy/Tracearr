/**
 * Login username collision auto-resolution (migration 0063, #928)
 *
 * The migration makes login usernames case-insensitively unique. When
 * login-capable accounts collide, the owner (or oldest) account keeps the
 * name, every other account gets a unique suffix from its own id, and the
 * RAISE gate behind the rename catches anything the rename cannot resolve.
 *
 * The suite's test database is already migrated, so each case drops the
 * unique index to simulate a pre-upgrade database, seeds colliding users,
 * and re-executes the migration file. afterEach re-runs the migration on an
 * empty users table so the index is back in place for every other test file
 * even when a case fails.
 *
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'fs';
import { db } from '../client.js';
import { users } from '../schema.js';
import { resetTestDb } from '@tracearr/test-utils/db';
import { createTestUser } from '@tracearr/test-utils/factories';

function collisionMigrationSql(): string {
  const migrationsDir = `${import.meta.dirname}/../migrations`;
  const file = readdirSync(migrationsDir).find(
    (name) =>
      name.endsWith('.sql') &&
      readFileSync(`${migrationsDir}/${name}`, 'utf8').includes('users_login_username_unique')
  );
  if (!file) {
    throw new Error('login username unique index migration file not found');
  }
  return readFileSync(`${migrationsDir}/${file}`, 'utf8');
}

const OWNER_ID = '18d9e320-9415-4d88-90e7-6dce323cf587';
const ADMIN_ID = 'a2df9127-6046-4547-acdf-21707e2423be';
const VIEWER_ID = 'c3ee0431-0f57-4e99-bdf0-32818f3534cf';

async function usernameOf(id: string): Promise<string> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row!.username;
}

describe('login username collision handling in the unique index migration', () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.execute(sql.raw('DROP INDEX IF EXISTS users_login_username_unique'));
  });

  afterEach(async () => {
    await resetTestDb();
    await db.execute(sql.raw(collisionMigrationSql()));
  });

  it('renames the admin and keeps the owner name for an owner/admin collision', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'moppen' });
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'moppen' });
    await db.update(users).set({ displayUsername: 'Moppen' }).where(eq(users.id, ADMIN_ID));

    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(OWNER_ID)).toBe('moppen');
    expect(await usernameOf(ADMIN_ID)).toBe('moppen-a2df9127');
    const [admin] = await db.select().from(users).where(eq(users.id, ADMIN_ID));
    expect(admin!.displayUsername).toBe('Moppen');
  });

  it('treats the collision case-insensitively', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'Moppen' });
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'moppen' });

    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(OWNER_ID)).toBe('Moppen');
    expect(await usernameOf(ADMIN_ID)).toBe('moppen-a2df9127');
  });

  it('keeps the oldest account when no owner is involved', async () => {
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'shared' });
    await createTestUser({ id: VIEWER_ID, role: 'viewer', username: 'shared' });
    await db
      .update(users)
      .set({ createdAt: new Date('2024-01-01T00:00:00Z') })
      .where(eq(users.id, ADMIN_ID));
    await db
      .update(users)
      .set({ createdAt: new Date('2025-01-01T00:00:00Z') })
      .where(eq(users.id, VIEWER_ID));

    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(ADMIN_ID)).toBe('shared');
    expect(await usernameOf(VIEWER_ID)).toBe('shared-c3ee0431');
  });

  it('resolves a three-way collision to three distinct usernames', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'moppen' });
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'moppen' });
    await createTestUser({ id: VIEWER_ID, role: 'viewer', username: 'moppen' });

    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(OWNER_ID)).toBe('moppen');
    expect(await usernameOf(ADMIN_ID)).toBe('moppen-a2df9127');
    expect(await usernameOf(VIEWER_ID)).toBe('moppen-c3ee0431');
  });

  it('ignores member rows sharing a login username', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'moppen' });
    await createTestUser({ id: VIEWER_ID, role: 'member', username: 'moppen' });

    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(OWNER_ID)).toBe('moppen');
    expect(await usernameOf(VIEWER_ID)).toBe('moppen');
  });

  it('changes nothing without a collision and is idempotent', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'moppen' });
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'other' });

    await db.execute(sql.raw(collisionMigrationSql()));
    await db.execute(sql.raw(collisionMigrationSql()));

    expect(await usernameOf(OWNER_ID)).toBe('moppen');
    expect(await usernameOf(ADMIN_ID)).toBe('other');
  });

  it('still fails loudly when a rename target is already taken', async () => {
    await createTestUser({ id: OWNER_ID, role: 'owner', username: 'moppen' });
    await createTestUser({ id: ADMIN_ID, role: 'admin', username: 'moppen' });
    // Occupies exactly the name the admin rename would produce.
    await createTestUser({ id: VIEWER_ID, role: 'viewer', username: 'moppen-a2df9127' });

    await expect(db.execute(sql.raw(collisionMigrationSql()))).rejects.toThrow(/upgrade blocked/);
  });
});
