import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CacheService } from '../../services/cache.js';

describe('sweepOrphanedPendingSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should discard pending sessions older than 2 minutes', async () => {
    const mockCacheService = {
      getAllPendingSessionKeys: vi.fn().mockResolvedValue([
        { serverId: 'server-1', sessionKey: 'old-session' },
        { serverId: 'server-1', sessionKey: 'new-session' },
      ]),
      getPendingSession: vi.fn().mockImplementation((serverId: string, sessionKey: string) => {
        if (sessionKey === 'old-session') {
          return {
            id: 'session-id-old',
            lastSeenAt: Date.now() - 3 * 60 * 1000, // 3 minutes ago
            serverUser: { id: 'user-1' },
          };
        }
        return {
          id: 'session-id-new',
          lastSeenAt: Date.now() - 30 * 1000, // 30 seconds ago
          serverUser: { id: 'user-1' },
        };
      }),
      deletePendingSession: vi.fn(),
      removeActiveSession: vi.fn(),
    } as unknown as CacheService;

    // Import and call sweepOrphanedPendingSessions
    const { sweepOrphanedPendingSessions } = await import('../sseProcessor.js');
    await sweepOrphanedPendingSessions(mockCacheService);

    expect(mockCacheService.deletePendingSession).toHaveBeenCalledWith('server-1', 'old-session');
    expect(mockCacheService.deletePendingSession).not.toHaveBeenCalledWith(
      'server-1',
      'new-session'
    );
  });

  it('srems a set member whose per-session hash already expired', async () => {
    const mockCacheService = {
      getAllPendingSessionKeys: vi.fn().mockResolvedValue([
        { serverId: 'server-1', sessionKey: 'zombie-session' },
        { serverId: 'server-1', sessionKey: 'new-session' },
      ]),
      // The zombie's hash TTL'd out already, so a lookup returns null even
      // though the member is still present in PENDING_SESSION_IDS.
      getPendingSession: vi.fn().mockImplementation((_serverId: string, sessionKey: string) => {
        if (sessionKey === 'zombie-session') return null;
        return {
          id: 'session-id-new',
          lastSeenAt: Date.now() - 30 * 1000,
          serverUser: { id: 'user-1' },
        };
      }),
      deletePendingSession: vi.fn(),
      removeActiveSession: vi.fn(),
    } as unknown as CacheService;

    const { sweepOrphanedPendingSessions } = await import('../sseProcessor.js');
    await sweepOrphanedPendingSessions(mockCacheService);

    // deletePendingSession's srem is what clears the zombie set member; its
    // del is a harmless no-op since the hash is already gone.
    expect(mockCacheService.deletePendingSession).toHaveBeenCalledWith(
      'server-1',
      'zombie-session'
    );
    expect(mockCacheService.removeActiveSession).not.toHaveBeenCalled();
  });
});
