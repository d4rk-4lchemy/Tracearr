import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { users, mobileSessions, authSessions, authAccounts, authVerifications } from '../schema.js';

describe('better auth schema', () => {
  it('adds email verification and display username to users', () => {
    const cols = getTableColumns(users);
    expect(cols.emailVerified).toBeDefined();
    expect(cols.displayUsername).toBeDefined();
  });

  it('defines auth session table with token and user fk', () => {
    const cols = getTableColumns(authSessions);
    expect(cols.token).toBeDefined();
    expect(cols.expiresAt).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.impersonatedBy).toBeDefined();
  });

  it('defines auth account table with provider fields and password', () => {
    const cols = getTableColumns(authAccounts);
    expect(cols.accountId).toBeDefined();
    expect(cols.providerId).toBeDefined();
    expect(cols.password).toBeDefined();
    expect(cols.accessToken).toBeDefined();
    expect(cols.refreshToken).toBeDefined();
    expect(cols.accessTokenExpiresAt).toBeDefined();
  });

  it('defines verification table', () => {
    const cols = getTableColumns(authVerifications);
    expect(cols.identifier).toBeDefined();
    expect(cols.value).toBeDefined();
    expect(cols.expiresAt).toBeDefined();
  });

  it('links mobile sessions to better auth sessions', () => {
    const cols = getTableColumns(mobileSessions);
    expect(cols.betterAuthSessionId).toBeDefined();
  });
});
