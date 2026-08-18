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

vi.mock('../leaderLease.js', () => ({
  isLeader: vi.fn(() => true),
}));

vi.mock('../libraryEventSync.js', () => ({
  clearPendingLibraryEventSync: vi.fn(),
  clearPendingLibraryEventSyncs: vi.fn(),
  recordLibraryEvent: vi.fn(),
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
      retryFromFallback: vi.fn(),
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
      retryFromFallback: vi.fn(),
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

vi.mock('../mediaServer/dispatcharr/realtime.js', () => ({
  DispatcharrRealtimeConnector: vi.fn(function (config: { serverId: string; serverName: string }) {
    return {
      config,
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      retryFromFallback: vi.fn(),
      isInFallback: vi.fn().mockReturnValue(false),
      isHealthy: vi.fn().mockReturnValue(true),
      getStatus: vi.fn().mockReturnValue({
        serverId: config.serverId,
        serverName: config.serverName,
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

vi.mock('../leaderLease.js', () => ({
  isLeader: vi.fn().mockReturnValue(true),
}));

import { db } from '../../db/client.js';
import { SSEManager } from '../sseManager.js';
import { db } from '../../db/client.js';
import { isLeader } from '../leaderLease.js';
import { DispatcharrRealtimeConnector } from '../mediaServer/dispatcharr/realtime.js';
import { PlexEventSource } from '../mediaServer/plex/eventSource.js';
import type { CacheService, PubSubService } from '../cache.js';

interface PrivateManager {
  refreshConnectionStatuses: () => void;
  startReconciliation: () => void;
}

interface PrivateManagerInternals {
  connections: Map<string, { state: string }>;
  lastNudgeAt: Map<string, number>;
  handleConnectionStateChange: (
    serverId: string,
    serverName: string,
    state: string,
    status: {
      serverId: string;
      serverName: string;
      state: string;
      connectedAt: Date | null;
      lastEventAt: Date | null;
      reconnectAttempts: number;
      error: string | null;
    }
  ) => void;
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

    // Drive the private refresh directly - this is what the reconciliation timer calls
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
    // Do NOT call initialize() - cacheService stays null; must not throw
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

describe('SSEManager.addServer', () => {
  let manager: SSEManager;
  let cache: CacheService;

  beforeEach(() => {
    manager = new SSEManager();
    cache = makeCacheService();
  });

  afterEach(async () => {
    await manager.stop();
    vi.clearAllMocks();
  });

  it('disconnects and clears listeners on the eventSource when connect() throws', async () => {
    const disconnect = vi.fn();
    const removeAllListeners = vi.fn();
    vi.mocked(PlexEventSource).mockImplementationOnce(function () {
      return {
        on: vi.fn(),
        connect: vi.fn().mockRejectedValue(new Error('connect failed')),
        disconnect,
        removeAllListeners,
        retryFromFallback: vi.fn(),
        getStatus: vi.fn(),
      } as unknown as InstanceType<typeof PlexEventSource>;
    });

    await manager.initialize(cache, makePubSubService());

    await expect(
      manager.addServer('plex-1', 'Plex Server', 'plex', 'http://plex.local', 'token')
    ).rejects.toThrow('connect failed');

    expect(removeAllListeners).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    // Failed connect must never leave a tracked connection behind
    expect(manager.getStatus()).toEqual([]);
  });

  it('does not leak pendingOperations tracking after a failed connect, so retry can proceed', async () => {
    vi.mocked(PlexEventSource).mockImplementationOnce(function () {
      return {
        on: vi.fn(),
        connect: vi.fn().mockRejectedValue(new Error('connect failed')),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        retryFromFallback: vi.fn(),
        getStatus: vi.fn(),
      } as unknown as InstanceType<typeof PlexEventSource>;
    });

    await manager.initialize(cache, makePubSubService());

    await expect(
      manager.addServer('plex-1', 'Plex Server', 'plex', 'http://plex.local', 'token')
    ).rejects.toThrow('connect failed');

    // A retry with a working connect() must succeed - a stuck pendingOperations
    // entry from the failed attempt would silently no-op this call instead.
    await manager.addServer('plex-1', 'Plex Server', 'plex', 'http://plex.local', 'token');
    expect(manager.getStatus()).toHaveLength(1);
  });
});

describe('SSEManager connector configuration reconciliation', () => {
  let manager: SSEManager;
  let cache: CacheService;

  const baseServer = {
    id: 'dispatcharr-1',
    name: 'Dispatcharr',
    type: 'dispatcharr' as const,
    url: 'http://dispatcharr.local',
    token: 'credentials-token-old',
    ignoreAnonymousStreams: false,
    color: '#123456',
    displayOrder: 0,
    machineIdentifier: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  function mockServers(rows: unknown[]): void {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockResolvedValue(rows),
    } as never);
  }

  beforeEach(async () => {
    manager = new SSEManager();
    cache = makeCacheService();
    vi.mocked(isLeader).mockReturnValue(true);
    await manager.initialize(cache, makePubSubService());
    await manager.addServer(
      baseServer.id,
      baseServer.name,
      baseServer.type,
      baseServer.url,
      baseServer.token,
      baseServer.ignoreAnonymousStreams
    );
  });

  afterEach(async () => {
    await manager.stop();
    vi.clearAllMocks();
  });

  it.each([
    ['name', { name: 'Renamed Dispatcharr' }, { serverName: 'Renamed Dispatcharr' }],
    ['url', { url: 'http://dispatcharr-new.local/' }, { url: 'http://dispatcharr-new.local/' }],
    ['token', { token: 'credentials-token-new' }, { token: 'credentials-token-new' }],
    ['anonymous filtering', { ignoreAnonymousStreams: true }, { ignoreAnonymousStreams: true }],
  ])(
    'replaces a Dispatcharr connector when %s changes',
    async (_label, changes, expectedConfig) => {
      const oldConnector = vi.mocked(DispatcharrRealtimeConnector).mock.results[0]?.value as {
        disconnect: ReturnType<typeof vi.fn>;
        removeAllListeners: ReturnType<typeof vi.fn>;
      };
      mockServers([{ ...baseServer, ...changes }]);

      await manager.refresh();

      expect(oldConnector.removeAllListeners).toHaveBeenCalledOnce();
      expect(oldConnector.disconnect).toHaveBeenCalledOnce();
      expect(DispatcharrRealtimeConnector).toHaveBeenCalledTimes(2);
      expect(DispatcharrRealtimeConnector).toHaveBeenLastCalledWith(
        expect.objectContaining(expectedConfig)
      );
    }
  );

  it('replaces the connector implementation when the server type changes', async () => {
    const oldConnector = vi.mocked(DispatcharrRealtimeConnector).mock.results[0]?.value as {
      disconnect: ReturnType<typeof vi.fn>;
      removeAllListeners: ReturnType<typeof vi.fn>;
    };
    const { JellyfinEmbyEventSource } =
      await import('../mediaServer/shared/jellyfinEmbyEventSource.js');
    mockServers([{ ...baseServer, type: 'jellyfin' }]);

    await manager.refresh();

    expect(oldConnector.removeAllListeners).toHaveBeenCalledOnce();
    expect(oldConnector.disconnect).toHaveBeenCalledOnce();
    expect(JellyfinEmbyEventSource).toHaveBeenCalledOnce();
  });

  it('does not reconnect for unchanged connector fields or display-only changes', async () => {
    mockServers([{ ...baseServer, url: `${baseServer.url}/`, color: '#abcdef', displayOrder: 9 }]);

    await manager.refresh();

    expect(DispatcharrRealtimeConnector).toHaveBeenCalledOnce();
  });

  it('lets only the leader replace a connector after cross-replica configuration drift', async () => {
    mockServers([{ ...baseServer, token: 'credentials-token-new' }]);
    vi.mocked(isLeader).mockReturnValue(false);

    await manager.refresh();
    expect(DispatcharrRealtimeConnector).toHaveBeenCalledOnce();

    vi.mocked(isLeader).mockReturnValue(true);
    await manager.refresh();
    expect(DispatcharrRealtimeConnector).toHaveBeenCalledTimes(2);
  });

  it('does not create duplicate connectors during concurrent refresh calls', async () => {
    mockServers([{ ...baseServer, ignoreAnonymousStreams: true }]);

    await Promise.all([manager.refresh(), manager.refresh(), manager.refresh()]);

    expect(DispatcharrRealtimeConnector).toHaveBeenCalledTimes(2);
  });
});

describe('SSEManager Jellyfin/Emby SSE polling', () => {
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

  it('refreshes during a continuous Jellyfin progress-event burst', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    const { JellyfinEmbyEventSource } =
      await import('../mediaServer/shared/jellyfinEmbyEventSource.js');
    const instance = vi.mocked(JellyfinEmbyEventSource).mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const sessionEventHandler = instance.on.mock.calls.find(
      ([eventName]) => eventName === 'session:event'
    )?.[1] as ((event: { eventType: string }) => void) | undefined;

    expect(sessionEventHandler).toBeDefined();

    sessionEventHandler!({ eventType: 'progress' });
    await vi.advanceTimersByTimeAsync(900);
    sessionEventHandler!({ eventType: 'progress' });
    await vi.advanceTimersByTimeAsync(900);
    sessionEventHandler!({ eventType: 'progress' });
    await vi.advanceTimersByTimeAsync(900);
    sessionEventHandler!({ eventType: 'progress' });

    const { triggerServerPoll } = await import('../../jobs/poller/index.js');
    expect(triggerServerPoll).toHaveBeenCalledTimes(1);
    expect(triggerServerPoll).toHaveBeenCalledWith('jf-1', { immediateStops: false });
  });
});

describe('SSEManager.removeServer', () => {
  let manager: SSEManager;
  let cache: CacheService;

  beforeEach(() => {
    manager = new SSEManager();
    cache = makeCacheService();
  });

  afterEach(async () => {
    await manager.stop();
    vi.clearAllMocks();
  });

  it('prunes lastNudgeAt so a re-added server with the same id is not rate-limited by stale state', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    const internals = manager as unknown as PrivateManagerInternals;
    internals.handleConnectionStateChange('jf-1', 'Jellyfin Server', 'fallback', {
      serverId: 'jf-1',
      serverName: 'Jellyfin Server',
      state: 'fallback',
      connectedAt: null,
      lastEventAt: null,
      reconnectAttempts: 0,
      error: null,
    });

    manager.nudgeReconnect('jf-1');
    expect(internals.lastNudgeAt.has('jf-1')).toBe(true);

    await manager.removeServer('jf-1');

    expect(internals.lastNudgeAt.has('jf-1')).toBe(false);
  });
});

describe('SSEManager.nudgeReconnect', () => {
  let manager: SSEManager;
  let cache: CacheService;

  beforeEach(() => {
    manager = new SSEManager();
    cache = makeCacheService();
  });

  afterEach(async () => {
    await manager.stop();
    vi.clearAllMocks();
  });

  function fakeStatus(state: string) {
    return {
      serverId: 'jf-1',
      serverName: 'Jellyfin Server',
      state,
      connectedAt: null,
      lastEventAt: null,
      reconnectAttempts: 0,
      error: null,
    };
  }

  it('retries an unsupported server so a wrong 404 verdict heals on poll success', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    const internals = manager as unknown as PrivateManagerInternals;
    internals.handleConnectionStateChange(
      'jf-1',
      'Jellyfin Server',
      'unsupported',
      fakeStatus('unsupported')
    );

    manager.nudgeReconnect('jf-1');

    const { JellyfinEmbyEventSource } =
      await import('../mediaServer/shared/jellyfinEmbyEventSource.js');
    const instance = vi.mocked(JellyfinEmbyEventSource).mock.results[0]?.value as {
      retryFromFallback: ReturnType<typeof vi.fn>;
    };
    expect(instance.retryFromFallback).toHaveBeenCalledTimes(1);
  });

  it('does not retry a connected server', async () => {
    await manager.initialize(cache, makePubSubService());
    await manager.addServer('jf-1', 'Jellyfin Server', 'jellyfin', 'http://jf.local', 'token');

    const internals = manager as unknown as PrivateManagerInternals;
    internals.handleConnectionStateChange(
      'jf-1',
      'Jellyfin Server',
      'connected',
      fakeStatus('connected')
    );

    manager.nudgeReconnect('jf-1');

    const { JellyfinEmbyEventSource } =
      await import('../mediaServer/shared/jellyfinEmbyEventSource.js');
    const instance = vi.mocked(JellyfinEmbyEventSource).mock.results[0]?.value as {
      retryFromFallback: ReturnType<typeof vi.fn>;
    };
    expect(instance.retryFromFallback).not.toHaveBeenCalled();
  });
});

describe('SSEManager.refresh', () => {
  let manager: SSEManager;

  /** refresh() reads the whole servers table; the chain ends at .from(). */
  function mockServerRows(rows: unknown[]) {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockResolvedValue(rows),
    } as never);
  }

  const row = {
    id: 'plex-1',
    name: 'Plex Server',
    type: 'plex' as const,
    url: 'http://plex.local',
    token: 'token-1',
  };

  beforeEach(() => {
    manager = new SSEManager();
  });

  afterEach(async () => {
    await manager.stop();
    vi.clearAllMocks();
  });

  it('connects a server that has no connection yet', async () => {
    await manager.initialize(makeCacheService(), makePubSubService());
    mockServerRows([row]);

    await manager.refresh();

    expect(PlexEventSource).toHaveBeenCalledTimes(1);
    expect(vi.mocked(PlexEventSource).mock.calls[0]![0]).toMatchObject({ token: 'token-1' });
  });

  it('rebuilds a connection whose stored token was rotated', async () => {
    await manager.initialize(makeCacheService(), makePubSubService());
    await manager.addServer(row.id, row.name, row.type, row.url, 'token-1');
    vi.mocked(PlexEventSource).mockClear();

    mockServerRows([{ ...row, token: 'token-2' }]);
    await manager.refresh();

    // A live connection keeps the token it was built with, so the only way the
    // new one reaches Plex is a rebuild.
    expect(PlexEventSource).toHaveBeenCalledTimes(1);
    expect(vi.mocked(PlexEventSource).mock.calls[0]![0]).toMatchObject({ token: 'token-2' });
  });

  it('rebuilds a connection whose url changed', async () => {
    await manager.initialize(makeCacheService(), makePubSubService());
    await manager.addServer(row.id, row.name, row.type, row.url, row.token);
    vi.mocked(PlexEventSource).mockClear();

    mockServerRows([{ ...row, url: 'http://moved.local' }]);
    await manager.refresh();

    expect(vi.mocked(PlexEventSource).mock.calls[0]![0]).toMatchObject({
      url: 'http://moved.local',
    });
  });

  it('leaves a connection alone when url and token both still match', async () => {
    await manager.initialize(makeCacheService(), makePubSubService());
    await manager.addServer(row.id, row.name, row.type, row.url, row.token);
    vi.mocked(PlexEventSource).mockClear();

    mockServerRows([row]);
    await manager.refresh();

    // Reconciliation runs every 30s; rebuilding on every pass would drop the
    // stream continuously.
    expect(PlexEventSource).not.toHaveBeenCalled();
  });
});
