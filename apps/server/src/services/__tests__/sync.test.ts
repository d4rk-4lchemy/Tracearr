import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockLimit, mockReturning, mockGetUsers } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockGetUsers: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockReturning }) }) }),
  },
}));
vi.mock('../mediaServer/index.js', () => ({
  createMediaServerClient: () => ({ getUsers: mockGetUsers }),
  PlexClient: class {},
}));
vi.mock('../userService.js', () => ({ syncUserFromMediaServer: vi.fn() }));
vi.mock('../serverIdentity.js', () => ({ ensureServerIdentifier: vi.fn() }));
vi.mock('../../lib/revoke.js', () => ({ revokeSessionsForServerUsers: vi.fn() }));
vi.mock('../../lib/scope.js', () => ({ clearScope: vi.fn() }));

import { revokeSessionsForServerUsers } from '../../lib/revoke.js';
import { clearScope } from '../../lib/scope.js';
import { syncUserFromMediaServer } from '../userService.js';
import { syncServer } from '../sync.js';

const SERVER = {
  id: 'srv-1',
  type: 'jellyfin',
  url: 'http://jf.local',
  token: 'tok',
  machineIdentifier: 'mid',
  historicalAt: null,
};

function synced(id: string, newlyDisabled: boolean) {
  return { serverUser: { id }, user: {}, created: false, newlyDisabled } as never;
}

describe('syncServer revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([SERVER]);
    mockGetUsers.mockResolvedValue([{ id: 'ext-1' }, { id: 'ext-2' }]);
  });

  it('revokes an account the sync just saw disabled', async () => {
    vi.mocked(syncUserFromMediaServer)
      .mockResolvedValueOnce(synced('su-1', true))
      .mockResolvedValueOnce(synced('su-2', false));
    mockReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await syncServer('srv-1', { syncUsers: true, syncLibraries: false });

    expect(revokeSessionsForServerUsers).toHaveBeenCalledExactlyOnceWith(['su-1']);
  });

  it('revokes an account missing from the server response', async () => {
    vi.mocked(syncUserFromMediaServer).mockResolvedValue(synced('su-1', false));
    mockReturning.mockResolvedValueOnce([{ id: 'su-gone' }]).mockResolvedValueOnce([]);

    await syncServer('srv-1', { syncUsers: true, syncLibraries: false });

    expect(revokeSessionsForServerUsers).toHaveBeenCalledExactlyOnceWith(['su-gone']);
  });

  it('does not revoke a restored account, and widens its owner scope', async () => {
    vi.mocked(syncUserFromMediaServer).mockResolvedValue(synced('su-1', false));
    mockReturning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 'u-back' }, { userId: 'u-back' }]);

    await syncServer('srv-1', { syncUsers: true, syncLibraries: false });

    expect(revokeSessionsForServerUsers).toHaveBeenCalledExactlyOnceWith([]);
    expect(clearScope).toHaveBeenCalledExactlyOnceWith('u-back');
  });
});
