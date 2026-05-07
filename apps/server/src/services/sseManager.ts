/**
 * SSE Connection Manager
 *
 * Manages Server-Sent Events connections for all Plex servers.
 * Coordinates between SSE (real-time) and poller (fallback/reconciliation).
 *
 * Architecture:
 * - Primary: SSE connections for instant session updates
 * - Fallback: Polling when SSE fails or for servers that don't support SSE
 * - Reconciliation: Light periodic poll to catch any missed events
 */

import { EventEmitter } from 'events';
import {
  POLLING_INTERVALS,
  type SSEConnectionState,
  type SSEConnectionStatus,
  type PlexPlaySessionNotification,
} from '@tracearr/shared';
import { registerService, unregisterService } from './serviceTracker.js';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { PlexEventSource } from './mediaServer/plex/eventSource.js';
import { DispatcharrRealtimeConnector } from './mediaServer/dispatcharr/realtime.js';
import type { MediaSession } from './mediaServer/types.js';
import type { CacheService, PubSubService } from './cache.js';

// Events emitted by SSEManager for consumers
export interface SSEManagerEvents {
  'plex:session:playing': { serverId: string; notification: PlexPlaySessionNotification };
  'plex:session:paused': { serverId: string; notification: PlexPlaySessionNotification };
  'plex:session:stopped': { serverId: string; notification: PlexPlaySessionNotification };
  'plex:session:progress': { serverId: string; notification: PlexPlaySessionNotification };
  'dispatcharr:snapshot': { serverId: string; sessions: MediaSession[] };
  'connection:status': SSEConnectionStatus;
  'fallback:activated': { serverId: string; serverName: string };
  'fallback:deactivated': { serverId: string; serverName: string };
}

interface ServerConnection {
  serverId: string;
  serverName: string;
  serverType: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr';
  eventSource: PlexEventSource | null;
  dispatcharrRealtime: DispatcharrRealtimeConnector | null;
  state: SSEConnectionState;
  inFallback: boolean;
}

/**
 * SSEManager - Centralized management of SSE connections
 *
 * @example
 * const manager = new SSEManager();
 * await manager.initialize(cacheService, pubSubService);
 *
 * manager.on('plex:session:playing', ({ serverId, notification }) => {
 *   // Handle new/resumed playback
 * });
 *
 * manager.on('fallback:activated', ({ serverId }) => {
 *   // Enable polling for this server
 * });
 */
export class SSEManager extends EventEmitter {
  private connections = new Map<string, ServerConnection>();
  private cacheService: CacheService | null = null;
  private pubSubService: PubSubService | null = null;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private pendingOperations = new Set<string>();

  /**
   * Initialize the SSE manager with cache services
   */
  async initialize(cache: CacheService, pubSub: PubSubService): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.cacheService = cache;
    this.pubSubService = pubSub;
    this.initialized = true;

    console.log('[SSEManager] Initialized');
  }

  /**
   * Start realtime connections for all configured servers
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('SSEManager not initialized');
    }

    const allServers = await db.select().from(servers);
    console.log(`[SSEManager] Starting realtime manager for ${allServers.length} server(s)`);

    // Create realtime connections for each server in parallel
    await Promise.all(
      allServers.map((server) =>
        this.addServer(
          server.id,
          server.name,
          server.type as 'plex' | 'jellyfin' | 'emby' | 'dispatcharr',
          server.url,
          server.token,
          server.ignoreAnonymousStreams
        )
      )
    );

    // Start reconciliation timer
    this.startReconciliation();
    registerService('sse-manager', {
      name: 'SSE Manager',
      description: 'Manages realtime Plex SSE and Dispatcharr WS connections',
      intervalMs: POLLING_INTERVALS.SSE_RECONCILIATION,
    });
  }

  /**
   * Stop all SSE connections
   */
  async stop(): Promise<void> {
    console.log('[SSEManager] Stopping all connections');

    // Stop reconciliation
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    unregisterService('sse-manager');

    // Disconnect all realtime connections
    for (const connection of this.connections.values()) {
      if (connection.eventSource) {
        connection.eventSource.disconnect();
      }
      if (connection.dispatcharrRealtime) {
        connection.dispatcharrRealtime.removeAllListeners();
        connection.dispatcharrRealtime.disconnect();
      }
    }

    this.connections.clear();
  }

  /**
   * Add a server and establish SSE connection
   */
  async addServer(
    serverId: string,
    serverName: string,
    serverType: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr',
    url: string,
    token: string,
    ignoreAnonymousStreams = true
  ): Promise<void> {
    if (this.pendingOperations.has(serverId)) {
      console.log(`[SSEManager] Operation already in progress for ${serverName}, skipping`);
      return;
    }
    this.pendingOperations.add(serverId);

    try {
      // Remove existing connection if present
      if (this.connections.has(serverId)) {
        await this.removeServerInternal(serverId);
      }

      const connection: ServerConnection = {
        serverId,
        serverName,
        serverType,
        eventSource: null,
        dispatcharrRealtime: null,
        state: 'disconnected',
        inFallback: false,
      };
      this.connections.set(serverId, connection);

      if (serverType === 'plex') {
        const eventSource = new PlexEventSource({
          serverId,
          serverName,
          url,
          token,
        });

        // Wire up event handlers
        this.setupEventHandlers(eventSource, serverId, serverName);

        connection.eventSource = eventSource;

        // Connect
        await eventSource.connect();
      } else if (serverType === 'dispatcharr') {
        const realtime = new DispatcharrRealtimeConnector({
          serverId,
          serverName,
          url,
          token,
          ignoreAnonymousStreams,
        });

        this.setupDispatcharrRealtimeHandlers(realtime, serverId, serverName);
        connection.dispatcharrRealtime = realtime;
        connection.inFallback = realtime.isInFallback();
        connection.state = realtime.isInFallback() ? 'fallback' : 'connecting';

        await realtime.connect();
      } else {
        // Jellyfin/Emby: Start in fallback mode (polling)
        connection.inFallback = true;
        connection.state = 'fallback';
        this.emit('fallback:activated', { serverId, serverName });
      }
    } catch (error) {
      this.connections.delete(serverId);
      throw error;
    } finally {
      this.pendingOperations.delete(serverId);
    }
  }

  /**
   * Remove a server and disconnect SSE
   */
  async removeServer(serverId: string): Promise<void> {
    if (this.pendingOperations.has(serverId)) {
      console.log(
        `[SSEManager] Operation already in progress for server ${serverId}, skipping remove`
      );
      return;
    }
    this.pendingOperations.add(serverId);

    try {
      await this.removeServerInternal(serverId);
    } finally {
      this.pendingOperations.delete(serverId);
    }
  }

  private async removeServerInternal(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return;
    }

    if (connection.eventSource) {
      connection.eventSource.removeAllListeners();
      connection.eventSource.disconnect();
    }
    if (connection.dispatcharrRealtime) {
      connection.dispatcharrRealtime.removeAllListeners();
      connection.dispatcharrRealtime.disconnect();
    }

    this.connections.delete(serverId);
    console.log(`[SSEManager] Removed server ${connection.serverName}`);
  }

  /**
   * Get status of all connections
   */
  getStatus(): SSEConnectionStatus[] {
    const statuses: SSEConnectionStatus[] = [];

    for (const connection of this.connections.values()) {
      if (connection.eventSource) {
        statuses.push(connection.eventSource.getStatus());
      } else if (connection.dispatcharrRealtime) {
        const status = connection.dispatcharrRealtime.getStatus();
        statuses.push({
          serverId: status.serverId,
          serverName: status.serverName,
          state: status.state,
          connectedAt: status.connectedAt,
          lastEventAt: status.lastEventAt,
          reconnectAttempts: status.reconnectAttempts,
          error: status.error,
        });
      } else {
        // Non-SSE server (Jellyfin/Emby)
        statuses.push({
          serverId: connection.serverId,
          serverName: connection.serverName,
          state: connection.state,
          connectedAt: null,
          lastEventAt: null,
          reconnectAttempts: 0,
          error: null,
        });
      }
    }

    return statuses;
  }

  /**
   * Check if a server is using fallback (polling)
   */
  isInFallback(serverId: string): boolean {
    const connection = this.connections.get(serverId);
    return connection?.inFallback ?? true; // Default to fallback if not found
  }

  getDispatcharrLatestSessions(serverId: string): MediaSession[] | null {
    const connection = this.connections.get(serverId);
    if (!connection?.dispatcharrRealtime) return null;
    return connection.dispatcharrRealtime.getLatestSessions();
  }

  isDispatcharrRealtimeHealthy(serverId: string): boolean {
    const connection = this.connections.get(serverId);
    if (!connection || connection.serverType !== 'dispatcharr' || !connection.dispatcharrRealtime) {
      return false;
    }
    return connection.dispatcharrRealtime.getMode() === 'ws' && !connection.dispatcharrRealtime.isInFallback();
  }

  /**
   * Get list of servers that need polling (fallback mode or non-Plex)
   */
  getServersNeedingPoll(): string[] {
    const serverIds: string[] = [];

    for (const connection of this.connections.values()) {
      if (connection.inFallback || connection.serverType !== 'plex') {
        serverIds.push(connection.serverId);
      }
    }

    return serverIds;
  }

  /**
   * Set up event handlers for a PlexEventSource
   */
  private setupEventHandlers(
    eventSource: PlexEventSource,
    serverId: string,
    serverName: string
  ): void {
    // Session events - forward to processor
    eventSource.on('session:playing', (notification: PlexPlaySessionNotification) => {
      this.emit('plex:session:playing', { serverId, notification });
    });

    eventSource.on('session:paused', (notification: PlexPlaySessionNotification) => {
      this.emit('plex:session:paused', { serverId, notification });
    });

    eventSource.on('session:stopped', (notification: PlexPlaySessionNotification) => {
      this.emit('plex:session:stopped', { serverId, notification });
    });

    eventSource.on('session:progress', (notification: PlexPlaySessionNotification) => {
      this.emit('plex:session:progress', { serverId, notification });
    });

    // Connection state changes
    eventSource.on('connection:state', (state: SSEConnectionState) => {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.state = state;

        // Handle fallback transitions
        if (state === 'fallback' && !connection.inFallback) {
          connection.inFallback = true;
          console.log(`[SSEManager] Server ${serverName} entering fallback mode`);
          this.emit('fallback:activated', { serverId, serverName });
        } else if (state === 'connected' && connection.inFallback) {
          connection.inFallback = false;
          console.log(`[SSEManager] Server ${serverName} exiting fallback mode`);
          this.emit('fallback:deactivated', { serverId, serverName });
        }

        // Emit status update
        this.emit('connection:status', eventSource.getStatus());
      }
    });

    eventSource.on('connection:error', (error: Error) => {
      console.error(`[SSEManager] Connection error for ${serverName}:`, error.message);
    });
  }

  private setupDispatcharrRealtimeHandlers(
    realtime: DispatcharrRealtimeConnector,
    serverId: string,
    serverName: string
  ): void {
    realtime.on('snapshot:update', ({ sessions }) => {
      this.emit('dispatcharr:snapshot', { serverId, sessions });
    });

    realtime.on('connection:status', (status) => {
      const connection = this.connections.get(serverId);
      if (!connection) return;
      connection.state = status.state;
      connection.inFallback = status.mode !== 'ws' || status.state === 'fallback';

      this.emit('connection:status', {
        serverId: status.serverId,
        serverName: status.serverName,
        state: status.state,
        connectedAt: status.connectedAt,
        lastEventAt: status.lastEventAt,
        reconnectAttempts: status.reconnectAttempts,
        error: status.error,
      });
    });

    realtime.on('fallback:activated', ({ reason }) => {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.inFallback = true;
        connection.state = 'fallback';
      }
      console.warn(`[SSEManager] Dispatcharr ${serverName} entering fallback: ${reason}`);
      this.emit('fallback:activated', { serverId, serverName });
    });

    realtime.on('fallback:deactivated', () => {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.inFallback = false;
        connection.state = 'connected';
      }
      console.info(`[SSEManager] Dispatcharr ${serverName} exited fallback`);
      this.emit('fallback:deactivated', { serverId, serverName });
    });
  }

  /**
   * Start periodic reconciliation
   * Light poll to catch any events that might have been missed
   */
  private startReconciliation(): void {
    if (this.reconciliationTimer) {
      return;
    }

    console.log(
      `[SSEManager] Starting reconciliation (every ${POLLING_INTERVALS.SSE_RECONCILIATION / 1000}s)`
    );

    this.reconciliationTimer = setInterval(() => {
      this.emit('reconciliation:needed');
    }, POLLING_INTERVALS.SSE_RECONCILIATION);
  }

  /**
   * Manually trigger a reconnection attempt for a server
   */
  async reconnect(serverId: string): Promise<void> {
    if (this.pendingOperations.has(serverId)) {
      console.log(
        `[SSEManager] Operation already in progress for server ${serverId}, skipping reconnect`
      );
      return;
    }
    this.pendingOperations.add(serverId);

    try {
      const connection = this.connections.get(serverId);
      if (!connection) {
        return;
      }

      console.log(`[SSEManager] Manual reconnect for ${connection.serverName}`);
      if (connection.eventSource) {
        connection.eventSource.disconnect();
        await connection.eventSource.connect();
      } else if (connection.dispatcharrRealtime) {
        connection.dispatcharrRealtime.disconnect();
        await connection.dispatcharrRealtime.connect();
      }
    } finally {
      this.pendingOperations.delete(serverId);
    }
  }

  /**
   * Refresh server list (call when servers are added/removed)
   */
  async refresh(): Promise<void> {
    const refreshLockId = '__refresh__';
    if (this.pendingOperations.has(refreshLockId)) {
      console.log('[SSEManager] Refresh already in progress, skipping');
      return;
    }
    this.pendingOperations.add(refreshLockId);

    try {
      let allServers;
      try {
        allServers = await db.select().from(servers);
      } catch (error) {
        console.error('[SSEManager] Failed to fetch servers from database:', error);
        return;
      }

      const currentServerIds = new Set(allServers.map((s) => s.id));
      const connectedServerIds = new Set(this.connections.keys());

      for (const serverId of connectedServerIds) {
        if (!currentServerIds.has(serverId)) {
          await this.removeServerInternal(serverId);
        }
      }

      // Add new servers
      for (const server of allServers) {
        if (!connectedServerIds.has(server.id)) {
          await this.addServer(
            server.id,
            server.name,
            server.type as 'plex' | 'jellyfin' | 'emby' | 'dispatcharr',
            server.url,
            server.token,
            server.ignoreAnonymousStreams
          );
        }
      }
    } finally {
      this.pendingOperations.delete(refreshLockId);
    }
  }
}

// Singleton instance
export const sseManager = new SSEManager();
