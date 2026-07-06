import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({
  db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }) },
}));

vi.mock('../../websocket/index.js', () => ({
  broadcastToAll: vi.fn(),
}));

vi.mock('../../jobs/poller/index.js', () => ({
  triggerServerPoll: vi.fn().mockResolvedValue(undefined),
}));

// Mock the event sources so addServer() doesn't open real network connections.
// Must use regular functions (not arrows) so `new` works.
vi.mock('../mediaServer/plex/eventSource.js', () => ({
  PlexEventSource: vi.fn(function () {
    return {
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        serverId: 'plex-1',
        serverName: 'Plex Server',
        state: 'connected',
        connectedAt: new Date('2026-01-01T00:00:00Z'),
        lastEventAt: null,
        reconnectAttempts: 0,
        error: null,
      }),
    };
  }),
}));

vi.mock('../mediaServer/shared/jellyfinEmbyEventSource.js', () => ({
  JellyfinEmbyEventSource: vi.fn(function () {
    return {
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        serverId: 'jf-1',
        serverName: 'Jellyfin Server',
        state: 'connected',
        connectedAt: new Date('2026-01-01T00:00:00Z'),
        lastEventAt: null,
        reconnectAttempts: 0,
        error: null,
      }),
    };
  }),
}));

vi.mock('../serviceTracker.js', () => ({
  registerService: vi.fn(),
  unregisterService: vi.fn(),
}));

import { SSEManager } from '../sseManager.js';
import type { CacheService, PubSubService } from '../cache.js';

interface PrivateManager {
  refreshConnectionStatuses: () => void;
  startReconciliation: () => void;
}

function makeCacheService(): CacheService {
  return {
    setServerConnectionStatus: vi.fn().mockResolvedValue(undefined),
    getServerConnectionStatus: vi.fn().mockResolvedValue(null),
  } as unknown as CacheService;
}

function makePubSubService(): PubSubService {
  return {} as unknown as PubSubService;
}

describe('SSEManager.refreshConnectionStatuses', () => {
  let manager: SSEManager;
  let cache: CacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SSEManager();
    cache = makeCacheService();
  });

  afterEach(async () => {
    await manager.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('writes mode=realtime to Redis for a connected Jellyfin server', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    vi.mocked(cache.setServerConnectionStatus).mockClear();

    // Drive the private refresh directly — this is what the reconciliation timer calls
    (manager as unknown as PrivateManager).refreshConnectionStatuses();

    expect(cache.setServerConnectionStatus).toHaveBeenCalledOnce();
    expect(cache.setServerConnectionStatus).toHaveBeenCalledWith(
      'jf-1',
      expect.objectContaining({
        serverId: 'jf-1',
        mode: 'realtime',
        state: 'connected',
      })
    );
  });

  it('does not call broadcastToAll during the periodic refresh', async () => {
    const { broadcastToAll } = await import('../../websocket/index.js');

    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    vi.mocked(broadcastToAll).mockClear();

    (manager as unknown as PrivateManager).refreshConnectionStatuses();

    expect(broadcastToAll).not.toHaveBeenCalled();
  });

  it('skips refresh gracefully when no cacheService is set', () => {
    // Do NOT call initialize() — cacheService stays null; must not throw
    expect(() => {
      (manager as unknown as PrivateManager).refreshConnectionStatuses();
    }).not.toThrow();
  });

  it('catches and logs write failures without stopping the loop', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    vi.mocked(cache.setServerConnectionStatus).mockRejectedValue(new Error('Redis down'));

    expect(() => {
      (manager as unknown as PrivateManager).refreshConnectionStatuses();
    }).not.toThrow();

    await vi.runAllTimersAsync();
  });

  it('calls refreshConnectionStatuses on the reconciliation interval', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    vi.mocked(cache.setServerConnectionStatus).mockClear();

    (manager as unknown as PrivateManager).startReconciliation();

    await vi.advanceTimersByTimeAsync(30_001);

    expect(cache.setServerConnectionStatus).toHaveBeenCalledWith(
      'jf-1',
      expect.objectContaining({ mode: 'realtime', state: 'connected' })
    );
  });
});
