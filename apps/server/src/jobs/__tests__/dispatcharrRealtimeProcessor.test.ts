import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSession } from '../../services/mediaServer/types.js';

const {
  mockSseManager,
  mockDb,
  mockGetActiveRulesV2,
  mockProcessServerSessions,
  mockProcessPollResults,
  mockRegisterService,
  mockUnregisterService,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events');
  return {
    mockSseManager: Object.assign(new EventEmitter(), {
      isDispatcharrRealtimeHealthy: vi.fn().mockReturnValue(true),
    }),
    mockDb: {
      select: vi.fn(),
    },
    mockGetActiveRulesV2: vi.fn().mockResolvedValue([]),
    mockProcessServerSessions: vi.fn().mockResolvedValue({
      success: true,
      newSessions: [],
      stoppedSessionKeys: [],
      updatedSessions: [],
      watchedTransitionOccurred: false,
    }),
    mockProcessPollResults: vi.fn().mockResolvedValue(undefined),
    mockRegisterService: vi.fn(),
    mockUnregisterService: vi.fn(),
  };
});

vi.mock('../../services/sseManager.js', () => ({
  sseManager: mockSseManager,
}));

vi.mock('../../db/client.js', () => ({
  db: mockDb,
}));

vi.mock('../poller/database.js', () => ({
  getActiveRulesV2: mockGetActiveRulesV2,
}));

vi.mock('../poller/processor.js', () => ({
  processServerSessions: mockProcessServerSessions,
}));

vi.mock('../poller/sessionLifecycle.js', () => ({
  processPollResults: mockProcessPollResults,
}));

vi.mock('../notificationQueue.js', () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock('../../services/serviceTracker.js', () => ({
  registerService: mockRegisterService,
  unregisterService: mockUnregisterService,
}));

import {
  initializeDispatcharrRealtimeProcessor,
  startDispatcharrRealtimeProcessor,
  stopDispatcharrRealtimeProcessor,
} from '../dispatcharrRealtimeProcessor.js';

const server = {
  id: 'dispatcharr-1',
  name: 'Dispatcharr',
  type: 'dispatcharr',
  url: 'http://dispatcharr.local',
  token: 'token',
  ignoreAnonymousStreams: true,
  dispatcharrLiveHistoryThresholdSeconds: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const liveSession: MediaSession = {
  sessionKey: 'channel-1:client-1',
  mediaId: 'channel-1',
  user: { id: 'dispatcharr-user', username: 'User One' },
  media: { title: 'News', type: 'live', durationMs: 0 },
  live: {
    channelTitle: 'News Channel',
    channelIdentifier: '1',
  },
  playback: { state: 'playing', positionMs: 0, progressPercent: 0 },
  player: { name: 'Client', deviceId: 'client-1', platform: 'Dispatcharr' },
  network: { ipAddress: '203.0.113.10', isLocal: false },
  quality: {
    bitrate: 0,
    isTranscode: false,
    videoDecision: 'directplay',
    audioDecision: 'directplay',
  },
};

function mockServerSelect(rows: unknown[]): void {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

describe('Dispatcharr realtime processor', () => {
  const cacheService = {
    getAllActiveSessions: vi.fn().mockResolvedValue([]),
  };
  const pubSubService = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSseManager.removeAllListeners();
    mockSseManager.isDispatcharrRealtimeHealthy.mockReturnValue(true);
    mockServerSelect([server]);
    mockProcessServerSessions.mockResolvedValue({
      success: true,
      newSessions: [],
      stoppedSessionKeys: [],
      updatedSessions: [],
      watchedTransitionOccurred: false,
    });
    initializeDispatcharrRealtimeProcessor(cacheService as never, pubSubService as never);
    startDispatcharrRealtimeProcessor();
  });

  afterEach(() => {
    stopDispatcharrRealtimeProcessor();
  });

  it('processes healthy Dispatcharr snapshots through direct snapshot mode', async () => {
    const newSession = { id: 'session-1', serverUserId: 'server-user-1' };
    mockProcessServerSessions.mockResolvedValueOnce({
      success: true,
      newSessions: [newSession],
      stoppedSessionKeys: [],
      updatedSessions: [],
      watchedTransitionOccurred: false,
    });

    mockSseManager.emit('dispatcharr:snapshot', {
      serverId: 'dispatcharr-1',
      sessions: [liveSession],
    });

    await vi.waitFor(() => {
      expect(mockProcessServerSessions).toHaveBeenCalledWith(
        server,
        [],
        expect.any(Set),
        [],
        { mediaSessions: [liveSession], immediateStops: true }
      );
    });

    expect(mockProcessPollResults).toHaveBeenCalledWith(
      expect.objectContaining({
        newSessions: [newSession],
        stoppedKeys: [],
        updatedSessions: [],
      })
    );
  });

  it('skips snapshots when Dispatcharr realtime is not healthy', async () => {
    mockSseManager.isDispatcharrRealtimeHealthy.mockReturnValue(false);

    mockSseManager.emit('dispatcharr:snapshot', {
      serverId: 'dispatcharr-1',
      sessions: [liveSession],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockProcessServerSessions).not.toHaveBeenCalled();
  });

  it('does not publish when a repeated snapshot produces no lifecycle changes', async () => {
    mockSseManager.emit('dispatcharr:snapshot', {
      serverId: 'dispatcharr-1',
      sessions: [liveSession],
    });

    await vi.waitFor(() => {
      expect(mockProcessServerSessions).toHaveBeenCalledOnce();
    });

    expect(mockProcessPollResults).not.toHaveBeenCalled();
  });

  it('publishes stopped sessions from an empty Dispatcharr snapshot', async () => {
    mockProcessServerSessions.mockResolvedValueOnce({
      success: true,
      newSessions: [],
      stoppedSessionKeys: ['dispatcharr-1:channel-1:client-1'],
      updatedSessions: [],
      watchedTransitionOccurred: false,
      confirmedFromPendingIds: new Set(),
    });

    mockSseManager.emit('dispatcharr:snapshot', {
      serverId: 'dispatcharr-1',
      sessions: [],
    });

    await vi.waitFor(() => {
      expect(mockProcessPollResults).toHaveBeenCalledWith(
        expect.objectContaining({
          newSessions: [],
          stoppedKeys: ['dispatcharr-1:channel-1:client-1'],
          updatedSessions: [],
        })
      );
    });
  });
});
