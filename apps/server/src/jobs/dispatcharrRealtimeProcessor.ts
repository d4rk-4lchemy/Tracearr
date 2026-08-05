import type { ActiveSession } from '@tracearr/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';
import type { CacheService, PubSubService } from '../services/cache.js';
import type { MediaSession } from '../services/mediaServer/types.js';
import { registerService, unregisterService } from '../services/serviceTracker.js';
import { sseManager } from '../services/sseManager.js';
import { enqueueNotification } from './notificationQueue.js';
import { getActiveRulesV2 } from './poller/database.js';
import { processServerSessions } from './poller/processor.js';
import { processPollResults } from './poller/sessionLifecycle.js';
import { buildCompositeKey } from './poller/stateTracker.js';

let cacheService: CacheService | null = null;
let pubSubService: PubSubService | null = null;
let isRunning = false;

interface PendingSnapshot {
  sessions: MediaSession[];
  authoritative: boolean;
}

const serverGuards = new Map<string, { running: boolean; pending: PendingSnapshot | null }>();

function getGuard(serverId: string): { running: boolean; pending: PendingSnapshot | null } {
  let guard = serverGuards.get(serverId);
  if (!guard) {
    guard = { running: false, pending: null };
    serverGuards.set(serverId, guard);
  }
  return guard;
}

function buildCachedSessionKeys(
  cachedSessions: ActiveSession[],
  serverTypeMap: Map<string, 'plex' | 'jellyfin' | 'emby' | 'dispatcharr'>
): Set<string> {
  return new Set(
    cachedSessions.map((session) => {
      const serverType = serverTypeMap.get(session.serverId);
      if (serverType && serverType !== 'plex') {
        return buildCompositeKey({
          serverType,
          serverId: session.serverId,
          externalUserId: session.serverUserId,
          deviceId: session.deviceId ?? null,
          ratingKey: session.ratingKey ?? null,
          sessionKey: session.sessionKey,
        });
      }
      return `${session.serverId}:${session.sessionKey}`;
    })
  );
}

export function initializeDispatcharrRealtimeProcessor(
  cache: CacheService,
  pubSub: PubSubService
): void {
  cacheService = cache;
  pubSubService = pubSub;
}

async function processSnapshot(
  serverId: string,
  sessions: MediaSession[],
  authoritative: boolean
): Promise<void> {
  if (!cacheService || !pubSubService) {
    console.warn('[DispatcharrRealtimeProcessor] Not initialized, skipping snapshot');
    return;
  }
  if (!sseManager.isDispatcharrRealtimeHealthy(serverId)) {
    return;
  }

  const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
  if (server?.type !== 'dispatcharr') {
    return;
  }

  const cachedSessions = await cacheService.getAllActiveSessions();
  const serverTypeMap = new Map([[server.id, server.type]]);
  const cachedSessionKeys = buildCachedSessionKeys(cachedSessions, serverTypeMap);
  const activeRulesV2 = await getActiveRulesV2();

  const {
    newSessions,
    stoppedSessionKeys,
    updatedSessions,
    watchedTransitionOccurred,
    confirmedFromPendingIds,
  } = await processServerSessions(server, activeRulesV2, cachedSessionKeys, cachedSessions, {
    mediaSessions: sessions,
    immediateStops: authoritative,
  });

  if (
    newSessions.length === 0 &&
    stoppedSessionKeys.length === 0 &&
    updatedSessions.length === 0
  ) {
    return;
  }

  await processPollResults({
    newSessions,
    stoppedKeys: stoppedSessionKeys,
    updatedSessions,
    watchedTransitionOccurred,
    cachedSessions,
    cacheService,
    pubSubService,
    enqueueNotification,
    confirmedFromPendingIds,
  });
}

async function drainSnapshots(
  serverId: string,
  firstSnapshot: PendingSnapshot
): Promise<void> {
  const guard = getGuard(serverId);
  if (guard.running) {
    guard.pending = firstSnapshot;
    return;
  }

  guard.running = true;
  let snapshotToProcess: PendingSnapshot | null = firstSnapshot;

  try {
    while (snapshotToProcess) {
      const current = snapshotToProcess;
      snapshotToProcess = null;
      await processSnapshot(serverId, current.sessions, current.authoritative);
      snapshotToProcess = guard.pending;
      guard.pending = null;
    }
  } catch (error) {
    console.error(
      `[DispatcharrRealtimeProcessor] Failed to process snapshot for ${serverId}:`,
      error
    );
  } finally {
    guard.running = false;
  }
}

const wrappedHandlers = {
  snapshot: ({
    serverId,
    sessions,
    authoritative = true,
  }: {
    serverId: string;
    sessions: MediaSession[];
    authoritative?: boolean;
  }) => {
    void drainSnapshots(serverId, { sessions, authoritative });
  },
};

export function startDispatcharrRealtimeProcessor(): void {
  if (!cacheService || !pubSubService) {
    throw new Error('Dispatcharr realtime processor not initialized');
  }
  if (isRunning) return;
  isRunning = true;
  registerService('dispatcharr-realtime-processor', {
    name: 'Dispatcharr Realtime Processor',
    description: 'Processes healthy Dispatcharr WS snapshots directly',
    intervalMs: 0,
  });

  sseManager.on('dispatcharr:snapshot', wrappedHandlers.snapshot);
}

export function stopDispatcharrRealtimeProcessor(): void {
  if (!isRunning) return;
  isRunning = false;
  unregisterService('dispatcharr-realtime-processor');
  sseManager.off('dispatcharr:snapshot', wrappedHandlers.snapshot);
  serverGuards.clear();
}
