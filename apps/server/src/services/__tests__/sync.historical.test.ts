import { describe, expect, it, vi } from 'vitest';

const { mockLimit, mockCreateClient } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
  },
}));
vi.mock('../mediaServer/index.js', () => ({
  createMediaServerClient: mockCreateClient,
  PlexClient: class {},
}));
vi.mock('../userService.js', () => ({ syncUserFromMediaServer: vi.fn() }));
vi.mock('../serverIdentity.js', () => ({ ensureServerIdentifier: vi.fn() }));

import { ServerHistoricalError } from '../liveServers.js';
import { ensureServerIdentifier } from '../serverIdentity.js';
import { syncServer } from '../sync.js';

describe('syncServer on a historical server', () => {
  it('throws before reading the identity or building a client', async () => {
    mockLimit.mockResolvedValue([
      {
        id: 'srv-1',
        type: 'jellyfin',
        url: 'http://jf.local',
        token: 'tok',
        machineIdentifier: null,
        historicalAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);

    await expect(syncServer('srv-1')).rejects.toBeInstanceOf(ServerHistoricalError);
    expect(ensureServerIdentifier).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
