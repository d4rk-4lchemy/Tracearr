/**
 * SSE Processor Tests - Server Health Events
 *
 * Tests the fallback:activated and fallback:deactivated handlers:
 * - With nothing polling, server.down waits out the 60s threshold
 * - A reconnect cancels a pending down
 * - A reconnect sends server.up only when the health key says down
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEmitter } from 'events';

// Create mocks using vi.hoisted - must require EventEmitter inside for hoisting to work
const {
  mockSseManager,
  mockEnqueueNotification,
  mockDispatch,
  mockGetActiveAutomations,
  mockIsLiveServer,
  mockIsPollerRunning,
  mockLiveServers,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: EE } = require('events');
  return {
    mockSseManager: Object.assign(new EE() as EventEmitter, {
      isInFallback: vi.fn().mockReturnValue(true),
    }),
    mockEnqueueNotification: vi.fn().mockResolvedValue('job-id'),
    mockDispatch: vi.fn().mockResolvedValue({ violations: [], outcomes: [] }),
    mockGetActiveAutomations: vi.fn().mockResolvedValue([]),
    mockIsLiveServer: vi.fn().mockResolvedValue(true),
    mockIsPollerRunning: vi.fn().mockReturnValue(false),
    mockLiveServers: vi.fn().mockResolvedValue([]),
  };
});

// Mock the sseManager
vi.mock('../../services/sseManager.js', () => ({
  sseManager: mockSseManager,
}));

vi.mock('../../services/liveServers.js', () => ({
  isLiveServer: (...args: unknown[]) => mockIsLiveServer(...args),
  liveServers: () => mockLiveServers(),
}));

// Mock enqueueNotification
vi.mock('../notificationQueue.js', () => ({
  enqueueNotification: mockEnqueueNotification,
}));

// Mock other dependencies
vi.mock('../../db/client.js', () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));

vi.mock('../../services/mediaServer/index.js', () => ({
  createMediaServerClient: vi.fn(),
}));

vi.mock('../../services/geoip.js', () => ({
  geoipService: { lookup: vi.fn() },
}));

vi.mock('../poller/index.js', () => ({
  triggerReconciliationPoll: vi.fn(),
  isPollerRunning: () => mockIsPollerRunning(),
}));

vi.mock('../poller/sessionMapper.js', () => ({
  mapMediaSession: vi.fn(),
}));

vi.mock('../poller/stateTracker.js', () => ({
  calculatePauseAccumulation: vi.fn(),
  checkWatchCompletion: vi.fn(),
  detectMediaChange: vi.fn(),
  // Playback confirmation functions for delayed rule evaluation
  isPlaybackConfirmed: vi.fn().mockReturnValue(false),
  createInitialConfirmationState: vi.fn().mockReturnValue({
    confirmedPlayback: false,
    firstSeenAt: Date.now(),
    maxViewOffset: 0,
  }),
  updateConfirmationState: vi.fn().mockImplementation((state) => state),
}));

vi.mock('../poller/database.js', () => ({
  getServerUserIdByExternalId: vi.fn(() => {
    throw new Error('getServerUserIdByExternalId not configured in this test');
  }),
  getActiveAutomations: mockGetActiveAutomations,
  batchGetLibraryItemIdentity: vi.fn().mockResolvedValue(new Map()),
  batchGetRecentUserSessions: vi.fn(),
  mergeRecentSessionsForIdentity: (map: Map<string, unknown[]>, ids: string[]) =>
    ids.flatMap((id) => map.get(id) ?? []),
}));

vi.mock('../poller/violations.js', () => ({
  broadcastViolations: vi.fn(),
}));

vi.mock('../poller/sessionLifecycle.js', () => ({
  stopSessionAtomic: vi.fn(),
  findActiveSession: vi.fn(),
  findActiveSessionsAll: vi.fn(),
  buildActiveSession: vi.fn(),
  handleMediaChangeAtomic: vi.fn(),
  handleQualityChangeFallout: vi.fn(),
  confirmAndPersistSession: vi.fn(),
}));

vi.mock('../../services/automations/events/dispatcher.js', () => ({
  dispatch: (...args: unknown[]) => mockDispatch(...args),
  subscribe: vi.fn(),
}));
vi.mock('../../services/automations/events/contextAssembly.js', () => ({
  loadEvaluationContext: vi.fn().mockResolvedValue(null),
  loadServerContext: vi.fn(async (serverId: string) => ({
    server: { id: serverId, name: 'Test Server', type: 'plex' },
    inputs: {
      activeAutomations: [],
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: [],
    },
  })),
  serverContextFor: vi.fn(),
  installInputs: vi.fn(),
  assembleEvaluationInputs: vi.fn().mockResolvedValue({
    activeAutomations: [],
    activeSessions: [],
    recentSessions: [],
    identityServerUserIds: [],
  }),
  setContextAssemblyDeps: vi.fn(),
}));

// Import after mocking
import {
  clearServerDownState,
  initializeSSEProcessor,
  startSSEProcessor,
  stopSSEProcessor,
} from '../sseProcessor.js';
import { triggerReconciliationPoll } from '../poller/index.js';

const health = new Map<string, boolean>();

// Mock cache and pubsub services
const mockCacheService = {
  getServerHealth: vi.fn(async (serverId: string) => health.get(serverId) ?? null),
  setServerHealth: vi.fn(async (serverId: string, isHealthy: boolean) => {
    const previous = health.get(serverId) ?? null;
    health.set(serverId, isHealthy);
    return previous;
  }),
  resetServerFailCount: vi.fn(),
  getAllActiveSessions: vi.fn().mockResolvedValue([]),
  getSessionById: vi.fn(),
  addActiveSession: vi.fn(),
  updateActiveSession: vi.fn(),
  removeActiveSession: vi.fn(),
  addUserSession: vi.fn(),
  removeUserSession: vi.fn(),
  withSessionCreateLock: vi.fn(),
  hasTerminationCooldown: vi.fn().mockResolvedValue(false),
  setTerminationCooldown: vi.fn(),
  hasTerminationCooldownComposite: vi.fn().mockResolvedValue(false),
  setTerminationCooldownComposite: vi.fn(),
  // Pending session methods for delayed rule evaluation
  getPendingSession: vi.fn().mockResolvedValue(null),
  setPendingSession: vi.fn(),
  deletePendingSession: vi.fn(),
  getAllPendingSessionKeys: vi.fn().mockResolvedValue([]),
};

const mockPubSubService = {
  publish: vi.fn(),
  subscribe: vi.fn(),
};

describe('SSE Processor - Server Health Notifications', () => {
  const listening = [
    {
      id: 'a1',
      triggers: [
        { id: 'n1', type: 'server.down', enabled: true },
        { id: 'n2', type: 'server.up', enabled: true },
      ],
    },
  ];
  const down = (serverId: string, serverName: string) =>
    mockSseManager.emit('fallback:activated', { serverId, serverName });
  const up = (serverId: string, serverName: string) =>
    mockSseManager.emit('fallback:deactivated', { serverId, serverName });
  const dispatched = (type: 'server.down' | 'server.up', serverId: string) =>
    mockDispatch.mock.calls.filter(
      (call) =>
        (call[0] as { type: string; server: { id: string } }).type === type &&
        (call[0] as { server: { id: string } }).server.id === serverId
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetActiveAutomations.mockResolvedValue(listening);
    mockIsLiveServer.mockResolvedValue(true);
    mockIsPollerRunning.mockReturnValue(false);
    mockLiveServers.mockResolvedValue([]);
    mockSseManager.isInFallback.mockReturnValue(true);
    health.clear();
    mockSseManager.removeAllListeners();

    // Initialize and start the processor
    initializeSSEProcessor(mockCacheService as never, mockPubSubService as never);
    startSSEProcessor();
  });

  afterEach(() => {
    stopSSEProcessor();
    vi.useRealTimers();
  });

  describe('fallback:activated with nothing polling (session sync off)', () => {
    it('dispatches nothing when the server turned historical before the threshold', async () => {
      mockIsLiveServer.mockResolvedValue(false);
      down('server-1', 'Plex');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(dispatched('server.down', 'server-1')).toHaveLength(0);

      up('server-1', 'Plex');
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatched('server.up', 'server-1')).toHaveLength(0);
    });

    it('forgets a pending down when the switch clears the server', async () => {
      down('server-1', 'Plex');
      clearServerDownState('server-1');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(dispatched('server.down', 'server-1')).toHaveLength(0);
    });

    it('sends no server.down when the connection returns while the timer reads the server row', async () => {
      let answer!: (live: boolean) => void;
      mockIsLiveServer.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      down('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(60_000);

      up('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(0);
      answer(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(dispatched('server.down', 'server-1')).toHaveLength(0);
      expect(health.get('server-1')).toBe(true);
    });

    it('stops the timer of a server that is no longer live', async () => {
      mockIsLiveServer.mockResolvedValue(false);
      down('server-1', 'Plex');
      await vi.advanceTimersByTimeAsync(60_000);
      const reads = mockIsLiveServer.mock.calls.length;

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(mockIsLiveServer.mock.calls.length).toBe(reads);
    });

    it('marks down a server that never connects after a start, and not one that does', async () => {
      stopSSEProcessor();
      mockLiveServers.mockResolvedValue([
        { id: 'server-1', name: 'Never Connects' },
        { id: 'server-2', name: 'Connects' },
      ]);
      startSSEProcessor();
      await vi.advanceTimersByTimeAsync(5_000);
      up('server-2', 'Connects');

      await vi.advanceTimersByTimeAsync(55_000);

      expect(dispatched('server.down', 'server-1')).toHaveLength(1);
      expect(dispatched('server.down', 'server-2')).toHaveLength(0);
    });

    it('skips a server whose live connection opened before the start finished reading servers', async () => {
      stopSSEProcessor();
      mockLiveServers.mockResolvedValue([{ id: 'server-1', name: 'Plex' }]);
      mockSseManager.isInFallback.mockReturnValue(false);
      startSSEProcessor();

      await vi.advanceTimersByTimeAsync(2 * 60_000);

      expect(dispatched('server.down', 'server-1')).toHaveLength(0);
    });

    it('keeps the server marked down through a long outage without a second down', async () => {
      down('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(15 * 60_000);

      expect(dispatched('server.down', 'server-1')).toHaveLength(1);
      // The health key expires after 10 minutes; the reconnect reads it to decide on server.up.
      expect(
        mockCacheService.setServerHealth.mock.calls.filter(([, isHealthy]) => !isHealthy).length
      ).toBeGreaterThan(10);

      up('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatched('server.up', 'server-1')).toHaveLength(1);
    });

    it('holds the server.down dispatch for the 60s threshold', async () => {
      down('server-1', 'Test Server');

      await vi.advanceTimersByTimeAsync(59_000);
      expect(mockDispatch).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockDispatch).toHaveBeenCalledWith(
        {
          type: 'server.down',
          at: expect.any(Date),
          server: { id: 'server-1', name: 'Test Server', type: 'plex' },
        },
        expect.objectContaining({ activeSessions: [] })
      );
    });

    it('leaves the notification to whatever automation listens for the trigger', async () => {
      down('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockEnqueueNotification).not.toHaveBeenCalled();
    });

    it('dispatches nothing when no automation listens for server.down', async () => {
      mockGetActiveAutomations.mockResolvedValue([]);
      down('server-1', 'Test Server');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should handle multiple servers going down independently', async () => {
      down('server-1', 'Server 1');

      // 30 seconds later, Server 2 goes down
      await vi.advanceTimersByTimeAsync(30_000);
      down('server-2', 'Server 2');

      // At 60s, only Server 1 has reached its threshold
      await vi.advanceTimersByTimeAsync(30_000);
      expect(dispatched('server.down', 'server-1')).toHaveLength(1);
      expect(dispatched('server.down', 'server-2')).toHaveLength(0);

      // At 90s (60s after Server 2), Server 2 follows
      await vi.advanceTimersByTimeAsync(30_000);
      expect(dispatched('server.down', 'server-2')).toHaveLength(1);
    });

    it('should replace pending notification if same server triggers again', async () => {
      down('server-1', 'Test Server');

      // 30 seconds later, same server triggers fallback again (e.g., retry logic)
      await vi.advanceTimersByTimeAsync(30_000);
      down('server-1', 'Test Server');

      // Original 60s would be at 60s, but we reset, so need 60s from second trigger
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockDispatch).not.toHaveBeenCalled();

      // 60s from second trigger (at 90s total)
      await vi.advanceTimersByTimeAsync(30_000);
      expect(dispatched('server.down', 'server-1')).toHaveLength(1);
    });
  });

  describe('fallback:deactivated (server comes back up)', () => {
    it('should cancel pending notification if server recovers before threshold', async () => {
      down('server-1', 'Test Server');

      // Server comes back up after 30 seconds (before 60s threshold)
      await vi.advanceTimersByTimeAsync(30_000);
      up('server-1', 'Test Server');

      // Even after the original threshold passes, nothing announces it went down
      await vi.advanceTimersByTimeAsync(60_000);
      expect(dispatched('server.down', 'server-1')).toHaveLength(0);
    });

    it('dispatches server.up once the server was marked down', async () => {
      down('server-1', 'Test Server');
      await vi.advanceTimersByTimeAsync(60_000);
      mockDispatch.mockClear();

      up('server-1', 'Test Server');
      await vi.runAllTimersAsync();

      expect(mockDispatch).toHaveBeenCalledWith(
        {
          type: 'server.up',
          at: expect.any(Date),
          server: { id: 'server-1', name: 'Test Server', type: 'plex' },
        },
        expect.objectContaining({ activeSessions: [] })
      );
      expect(mockEnqueueNotification).not.toHaveBeenCalled();
    });

    it('should not send server_up if server was never marked as down', async () => {
      // Server comes up without ever going down (e.g., initial connection)
      up('server-1', 'Test Server');

      await vi.runAllTimersAsync();

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('sends no server.up for a historical server whose health still says down', async () => {
      health.set('server-1', false);
      mockIsLiveServer.mockResolvedValue(false);

      up('server-1', 'Test Server');
      await vi.runAllTimersAsync();

      expect(dispatched('server.up', 'server-1')).toHaveLength(0);
    });

    it('should trigger a reconciliation poll on reconnect to catch missed sessions', async () => {
      up('server-1', 'Test Server');

      await vi.runAllTimersAsync();

      expect(vi.mocked(triggerReconciliationPoll)).toHaveBeenCalled();
    });
  });

  describe('stopSSEProcessor cleanup', () => {
    it('should clear pending notifications on stop', async () => {
      down('server-1', 'Test Server');

      // Stop processor before threshold
      await vi.advanceTimersByTimeAsync(30_000);
      stopSSEProcessor();

      // Even after threshold, nothing fires (timer was cleared)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear multiple pending notifications on stop', async () => {
      down('server-1', 'Server 1');
      down('server-2', 'Server 2');
      down('server-3', 'Server 3');

      stopSSEProcessor();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('survives a dispatch that throws when the threshold trips', async () => {
      mockDispatch.mockRejectedValueOnce(new Error('dispatch error'));

      down('server-1', 'Test Server');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockDispatch).toHaveBeenCalled();
    });
  });
});
