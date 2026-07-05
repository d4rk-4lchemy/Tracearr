import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { resetTestDb } from '@tracearr/test-utils/db';
import { createTestUser } from '@tracearr/test-utils/factories';
import { verifyPassword } from '../../src/utils/password.js';
import {
  db,
  users,
  authAccounts,
  authSessions,
  getRedis,
  getSetting,
  resetPasswordCommand,
  setUsernameCommand,
  setEmailCommand,
  listUsersCommand,
  enableLocalLoginCommand,
} from '../lib/commands.js';

describe('admin cli commands', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await getRedis().quit();
  });

  describe('resetPasswordCommand', () => {
    it('works for an owner with no existing hash', async () => {
      const owner = await createTestUser({ role: 'owner', username: 'owner', passwordHash: null });
      await resetPasswordCommand({ username: 'owner', password: 'newPassword123' });

      const [account] = await db
        .select()
        .from(authAccounts)
        .where(and(eq(authAccounts.userId, owner.id), eq(authAccounts.providerId, 'credential')));
      expect(account).toBeDefined();
      expect(await verifyPassword('newPassword123', account!.password!)).toBe(true);

      const [row] = await db.select().from(users).where(eq(users.id, owner.id));
      expect(row?.passwordHash).toBeTruthy();
    });

    it('updates an existing credential row instead of duplicating', async () => {
      const owner = await createTestUser({ role: 'owner', username: 'owner', passwordHash: null });
      await resetPasswordCommand({ username: 'owner', password: 'first1234' });
      await resetPasswordCommand({ username: 'owner', password: 'second1234' });
      const rows = await db
        .select()
        .from(authAccounts)
        .where(and(eq(authAccounts.userId, owner.id), eq(authAccounts.providerId, 'credential')));
      expect(rows).toHaveLength(1);
      expect(await verifyPassword('second1234', rows[0]!.password!)).toBe(true);
    });

    it('defaults to the first owner by created_at when no username is given', async () => {
      const owner = await createTestUser({
        role: 'owner',
        username: 'firstowner',
        passwordHash: null,
      });
      await resetPasswordCommand({ password: 'ownerPass123' });

      const [row] = await db.select().from(users).where(eq(users.id, owner.id));
      expect(row?.passwordHash).toBeTruthy();
    });

    it('throws a clear error for an unknown username', async () => {
      await expect(
        resetPasswordCommand({ username: 'doesnotexist', password: 'whatever123' })
      ).rejects.toThrow(/no user named/i);
    });

    it('invalidates existing Better Auth sessions on reset', async () => {
      const owner = await createTestUser({ role: 'owner', username: 'owner', passwordHash: null });
      const token = 'test-session-token-123';

      await db.insert(authSessions).values({
        id: crypto.randomUUID(),
        token,
        userId: owner.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const redis = getRedis();
      const prefix = process.env.REDIS_PREFIX ?? '';
      const sessionKey = `${prefix}tracearr:ba:${token}`;
      const listKey = `${prefix}tracearr:ba:active-sessions-${owner.id}`;
      await redis.set(sessionKey, JSON.stringify({ session: { token } }), 'EX', 3600);
      await redis.set(
        listKey,
        JSON.stringify([{ token, expiresAt: Date.now() + 3600000 }]),
        'EX',
        3600
      );

      await resetPasswordCommand({ username: 'owner', password: 'newPassword123' });

      const remaining = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, owner.id));
      expect(remaining).toHaveLength(0);
      expect(await redis.get(sessionKey)).toBeNull();
      expect(await redis.get(listKey)).toBeNull();
    });
  });

  describe('setUsernameCommand', () => {
    it('normalizes and preserves display form', async () => {
      await createTestUser({ role: 'owner', username: 'owner' });
      await setUsernameCommand({ identifier: 'owner', newUsername: 'NewName' });
      const [row] = await db.select().from(users).where(eq(users.username, 'newname'));
      expect(row?.displayUsername).toBe('NewName');
    });

    it('rejects a collision with a clean error and no partial write', async () => {
      await createTestUser({ role: 'owner', username: 'owner' });
      await createTestUser({ role: 'admin', username: 'admin' });

      await expect(
        setUsernameCommand({ identifier: 'admin', newUsername: 'owner' })
      ).rejects.toThrow(/already taken/i);

      const [adminRow] = await db.select().from(users).where(eq(users.username, 'admin'));
      expect(adminRow).toBeDefined();
      expect(adminRow?.displayUsername).not.toBe('owner');
    });

    it('throws for an unknown identifier', async () => {
      await expect(
        setUsernameCommand({ identifier: 'ghost', newUsername: 'whoever' })
      ).rejects.toThrow(/no user found/i);
    });
  });

  describe('setEmailCommand', () => {
    it('updates email and keeps email_verified true', async () => {
      const owner = await createTestUser({
        role: 'owner',
        username: 'owner',
        email: 'old@example.com',
      });
      await setEmailCommand({ username: 'owner', newEmail: 'new@example.com' });

      const [row] = await db.select().from(users).where(eq(users.id, owner.id));
      expect(row?.email).toBe('new@example.com');
      expect(row?.emailVerified).toBe(true);
    });

    it('rejects a collision with a clean error', async () => {
      await createTestUser({ role: 'owner', username: 'owner', email: 'owner@example.com' });
      await createTestUser({ role: 'admin', username: 'admin', email: 'admin@example.com' });

      await expect(
        setEmailCommand({ username: 'admin', newEmail: 'owner@example.com' })
      ).rejects.toThrow(/already in use/i);

      const [adminRow] = await db.select().from(users).where(eq(users.username, 'admin'));
      expect(adminRow?.email).toBe('admin@example.com');
    });
  });

  describe('listUsersCommand', () => {
    it('includes login methods derived from auth_accounts providers', async () => {
      const owner = await createTestUser({
        role: 'owner',
        username: 'owner',
        passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
      });
      await db.insert(authAccounts).values({
        id: crypto.randomUUID(),
        accountId: owner.id,
        providerId: 'credential',
        userId: owner.id,
        password: '$2b$12$abcdefghijklmnopqrstuv',
      });
      await db.insert(authAccounts).values({
        id: crypto.randomUUID(),
        accountId: 'plex-123',
        providerId: 'plex',
        userId: owner.id,
      });
      await createTestUser({ role: 'member', username: 'noaccounts' });

      const rows = await listUsersCommand();
      expect(rows).toHaveLength(2);

      const ownerRow = rows.find((r) => r.username === 'owner');
      expect(ownerRow).toMatchObject({ username: 'owner', role: 'owner' });
      expect(ownerRow?.loginMethods.sort()).toEqual(['credential', 'plex']);

      const noAccountsRow = rows.find((r) => r.username === 'noaccounts');
      expect(noAccountsRow?.loginMethods).toEqual([]);
    });
  });

  describe('enableLocalLoginCommand', () => {
    it('flips the setting', async () => {
      await enableLocalLoginCommand();
      expect(await getSetting('localLoginEnabled')).toBe(true);
    });
  });
});
