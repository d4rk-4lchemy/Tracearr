/**
 * Plex Token Refresh Job Tests
 *
 * Tests processPlexTokenRefresh in isolation:
 * - No candidate rows is a clean no-op (no PlexClient call, no db writes)
 * - A successful refresh writes the new token/expiry to auth_accounts and
 *   mirrors it into plex_accounts.plexToken and any linked servers.token
 * - A failed refresh (null return or thrown error) leaves the row untouched,
 *   counts toward `failed`, and doesn't block other candidates
 *
 * Mocks db by table identity (see routes/__tests__/authDecorators.test.ts)
 * since a single test may touch auth_accounts, plex_accounts, and servers
 * in one run and call order between them isn't the interesting thing to
 * assert on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../services/mediaServer/index.js', () => ({
  PlexClient: { refreshStrongToken: vi.fn() },
}));

import { db } from '../../db/client.js';
import { authAccounts, plexAccounts, servers } from '../../db/schema.js';
import { PlexClient } from '../../services/mediaServer/index.js';
import { processPlexTokenRefresh } from '../plexTokenRefresh.js';

function selectCandidates(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  } as never);
}

// Thenable chain covering `.set().where()` (awaited directly, auth_accounts
// and servers) and `.set().where().returning()` (plex_accounts).
function makeUpdateChain(returningResult: unknown[], onSet?: (args: unknown) => void) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((args: unknown) => {
    onSet?.(args);
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(returningResult));
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

function mockUpdates({
  plexAccountsReturning = [],
  authAccountsSet,
  plexAccountsSet,
  serversSet,
}: {
  plexAccountsReturning?: unknown[][];
  authAccountsSet?: (args: unknown) => void;
  plexAccountsSet?: (args: unknown) => void;
  serversSet?: (args: unknown) => void;
}) {
  const queue = [...plexAccountsReturning];
  vi.mocked(db.update).mockImplementation((table: unknown) => {
    if (table === authAccounts) return makeUpdateChain([], authAccountsSet) as never;
    if (table === plexAccounts) {
      return makeUpdateChain(queue.shift() ?? [], plexAccountsSet) as never;
    }
    if (table === servers) return makeUpdateChain([], serversSet) as never;
    return makeUpdateChain([]) as never;
  });
}

describe('processPlexTokenRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a clean no-op when there are no candidate rows', async () => {
    selectCandidates([]);
    mockUpdates({});

    const result = await processPlexTokenRefresh();

    expect(result).toEqual({ checked: 0, refreshed: 0, failed: 0 });
    expect(PlexClient.refreshStrongToken).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('writes the refreshed token/expiry and mirrors it to plex_accounts and servers', async () => {
    selectCandidates([{ id: 'row-1', accountId: 'plex-acct-1', refreshToken: 'old-refresh' }]);

    const expiresAt = new Date('2026-08-01T00:00:00Z');
    vi.mocked(PlexClient.refreshStrongToken).mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt,
    });

    const authAccountsSet = vi.fn();
    const plexAccountsSet = vi.fn();
    const serversSet = vi.fn();
    mockUpdates({
      plexAccountsReturning: [[{ id: 'plexacct-1' }]],
      authAccountsSet,
      plexAccountsSet,
      serversSet,
    });

    const result = await processPlexTokenRefresh();

    expect(result).toEqual({ checked: 1, refreshed: 1, failed: 0 });
    expect(PlexClient.refreshStrongToken).toHaveBeenCalledWith('old-refresh');

    expect(authAccountsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        accessTokenExpiresAt: expiresAt,
      })
    );
    expect(plexAccountsSet).toHaveBeenCalledWith({ plexToken: 'new-access' });
    expect(serversSet).toHaveBeenCalledWith(expect.objectContaining({ token: 'new-access' }));
  });

  it('does not write anything for a row when refreshStrongToken returns null, but still processes other rows', async () => {
    selectCandidates([
      { id: 'row-fail', accountId: 'plex-acct-fail', refreshToken: 'bad-refresh' },
      { id: 'row-ok', accountId: 'plex-acct-ok', refreshToken: 'good-refresh' },
    ]);

    vi.mocked(PlexClient.refreshStrongToken).mockImplementation(async (token: string) => {
      if (token === 'bad-refresh') return null;
      return { accessToken: 'ok-access', refreshToken: 'ok-refresh', expiresAt: new Date() };
    });

    const authAccountsSet = vi.fn();
    const plexAccountsSet = vi.fn();
    const serversSet = vi.fn();
    mockUpdates({
      plexAccountsReturning: [[{ id: 'plexacct-ok' }]],
      authAccountsSet,
      plexAccountsSet,
      serversSet,
    });

    const result = await processPlexTokenRefresh();

    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 1 });
    // Only the successful row should have produced writes.
    expect(authAccountsSet).toHaveBeenCalledTimes(1);
    expect(plexAccountsSet).toHaveBeenCalledWith({ plexToken: 'ok-access' });
    expect(serversSet).toHaveBeenCalledTimes(1);
  });

  it('counts a thrown error from refreshStrongToken as failed without writing, and keeps processing', async () => {
    selectCandidates([
      { id: 'row-throw', accountId: 'plex-acct-throw', refreshToken: 'throwing-refresh' },
      { id: 'row-ok', accountId: 'plex-acct-ok', refreshToken: 'good-refresh' },
    ]);

    vi.mocked(PlexClient.refreshStrongToken).mockImplementation(async (token: string) => {
      if (token === 'throwing-refresh') throw new Error('network blip');
      return { accessToken: 'ok-access', refreshToken: 'ok-refresh', expiresAt: new Date() };
    });

    const authAccountsSet = vi.fn();
    mockUpdates({
      plexAccountsReturning: [[{ id: 'plexacct-ok' }]],
      authAccountsSet,
    });

    const result = await processPlexTokenRefresh();

    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 1 });
    expect(authAccountsSet).toHaveBeenCalledTimes(1);
  });

  it('counts a row with an expiry but no stored refresh token as failed, without calling PlexClient', async () => {
    selectCandidates([{ id: 'row-no-refresh', accountId: 'plex-acct-x', refreshToken: null }]);
    mockUpdates({});

    const result = await processPlexTokenRefresh();

    expect(result).toEqual({ checked: 1, refreshed: 0, failed: 1 });
    expect(PlexClient.refreshStrongToken).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
