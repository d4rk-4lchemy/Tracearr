import { EventEmitter } from 'events';
import { SSE_CONFIG } from '@tracearr/shared';
import { DispatcharrClient } from './client.js';
import type { MediaSession, MediaUser } from '../types.js';
import {
  parseRealtimeChannelStatsPayload,
  parseRealtimeVodStatsPayload,
  parseSessionsFromVodStats,
  parseStatusResponse,
  type DispatcharrChannelStatus,
  type DispatcharrVodStatsResponse,
  type NormalizedDispatcharrChannel,
} from './parser.js';

export type DispatcharrRealtimeMode = 'ws' | 'rest-fallback' | 'rest-only-api-key';
type DispatcharrRealtimeState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'fallback';

export interface DispatcharrRealtimeStatus {
  serverId: string;
  serverName: string;
  mode: DispatcharrRealtimeMode;
  state: DispatcharrRealtimeState;
  connectedAt: Date | null;
  lastEventAt: Date | null;
  lastBootstrapAt: Date | null;
  reconnectAttempts: number;
  fallbackReason: string | null;
  error: string | null;
}

interface DispatcharrRealtimeEvents {
  'snapshot:update': { serverId: string; sessions: MediaSession[] };
  'connection:status': DispatcharrRealtimeStatus;
  'fallback:activated': { serverId: string; serverName: string; reason: string };
  'fallback:deactivated': { serverId: string; serverName: string };
}

interface WebSocketLike {
  onopen: ((this: WebSocketLike, ev: unknown) => void) | null;
  onmessage: ((this: WebSocketLike, ev: { data?: unknown }) => void) | null;
  onclose: ((this: WebSocketLike, ev: unknown) => void) | null;
  onerror: ((this: WebSocketLike, ev: unknown) => void) | null;
  close(): void;
}

type WebSocketCtor = new (url: string) => WebSocketLike;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractReferencedUserIds(channels: NormalizedDispatcharrChannel[]): string[] {
  const ids = new Set<string>();
  for (const channel of channels) {
    for (const client of channel.clients) {
      const raw = client.user_id;
      const userId = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
      if (!userId || userId === '0') continue;
      ids.add(userId);
    }
  }
  return [...ids];
}

function extractReferencedVodUserIds(stats: DispatcharrVodStatsResponse): string[] {
  const ids = new Set<string>();
  const groups = Array.isArray(stats.vod_connections) ? stats.vod_connections : [];

  for (const rawGroup of groups) {
    if (!isRecord(rawGroup)) continue;
    const connections = Array.isArray(rawGroup.connections) ? rawGroup.connections : [];
    for (const rawConnection of connections) {
      if (!isRecord(rawConnection)) continue;
      const rawUserId = rawConnection.user_id;
      const userId =
        typeof rawUserId === 'string'
          ? rawUserId.trim()
          : typeof rawUserId === 'number'
            ? String(rawUserId)
            : '';
      if (!userId || userId === '0') continue;
      ids.add(userId);
    }
  }

  return [...ids];
}

export class DispatcharrRealtimeConnector extends EventEmitter {
  private readonly serverId: string;
  private readonly serverName: string;
  private readonly baseUrl: string;
  private readonly client: DispatcharrClient;
  private readonly ignoreAnonymousStreams: boolean;

  private ws: WebSocketLike | null = null;
  private manualDisconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private mode: DispatcharrRealtimeMode;
  private state: DispatcharrRealtimeState = 'disconnected';
  private reconnectAttempts = 0;
  private fallbackReason: string | null = null;
  private lastError: Error | null = null;
  private connectedAt: Date | null = null;
  private lastEventAt: Date | null = null;
  private lastBootstrapAt: Date | null = null;

  private latestSessions: MediaSession[] = [];
  private latestLiveSessions: MediaSession[] = [];
  private latestVodSessions: MediaSession[] = [];
  private userCache = new Map<string, MediaUser>();
  private logoCache = new Map<string, string>();
  private programCache = new Map<string, string>();
  private lastProgramSetKey = '';

  constructor(config: {
    serverId: string;
    serverName: string;
    url: string;
    token: string;
    ignoreAnonymousStreams?: boolean;
  }) {
    super();
    this.serverId = config.serverId;
    this.serverName = config.serverName;
    this.baseUrl = config.url.replace(/\/$/, '');
    this.ignoreAnonymousStreams = config.ignoreAnonymousStreams !== false;
    this.client = new DispatcharrClient({
      id: config.serverId,
      name: config.serverName,
      url: config.url,
      token: config.token,
      ignoreAnonymousStreams: this.ignoreAnonymousStreams,
    });

    const tokenMode = this.client.getTokenMode();
    this.mode = tokenMode === 'api-key' || tokenMode === 'none' ? 'rest-only-api-key' : 'ws';
    if (this.mode === 'rest-only-api-key') {
      this.state = 'fallback';
      this.fallbackReason = 'Dispatcharr token is not JWT-capable; using REST polling only';
    }
  }

  getMode(): DispatcharrRealtimeMode {
    return this.mode;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  isInFallback(): boolean {
    return this.mode !== 'ws' || this.state === 'fallback';
  }

  getLatestSessions(): MediaSession[] {
    return this.latestSessions;
  }

  getStatus(): DispatcharrRealtimeStatus {
    return {
      serverId: this.serverId,
      serverName: this.serverName,
      mode: this.mode,
      state: this.state,
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      lastBootstrapAt: this.lastBootstrapAt,
      reconnectAttempts: this.reconnectAttempts,
      fallbackReason: this.fallbackReason,
      error: this.lastError?.message ?? null,
    };
  }

  async connect(): Promise<void> {
    if (this.mode === 'rest-only-api-key') {
      this.emitStatus();
      return;
    }
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.manualDisconnect = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    try {
      const jwtToken = await this.client.getWebSocketToken();
      if (!jwtToken) {
        this.activateFallback('Missing JWT token for Dispatcharr websocket');
        return;
      }

      const wsUrl = `${this.baseUrl}/ws/?token=${encodeURIComponent(jwtToken)}`;
      const WSClass = globalThis.WebSocket as unknown as WebSocketCtor | undefined;
      if (!WSClass) {
        this.activateFallback('WebSocket API is unavailable in current runtime');
        return;
      }

      const ws = new WSClass(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.connectedAt = new Date();
        this.reconnectAttempts = 0;
        this.lastError = null;
        const wasInFallback = this.mode !== 'ws' || this.state === 'fallback';
        this.mode = 'ws';
        this.fallbackReason = null;
        this.setState('connected');
        if (wasInFallback) {
          this.emit('fallback:deactivated', { serverId: this.serverId, serverName: this.serverName });
        }
        void this.bootstrapFromRest();
        this.resetHeartbeat();
      };

      ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        if (!text) return;
        void this.handleMessage(text);
      };

      ws.onerror = () => {
        this.lastError = new Error('Dispatcharr websocket error');
      };

      ws.onclose = () => {
        this.clearHeartbeatTimer();
        if (this.manualDisconnect) {
          this.setState('disconnected');
          return;
        }
        this.scheduleReconnect();
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private async handleMessage(rawText: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return;
    }

    if (isRecord(parsed) && parsed.type === 'connection_established') {
      this.lastEventAt = new Date();
      this.resetHeartbeat();
      this.emitStatus();
      return;
    }

    const channelStatsPayload = parseRealtimeChannelStatsPayload(parsed);
    if (channelStatsPayload) {
      this.lastEventAt = new Date();
      this.resetHeartbeat();

      const statusChannels = parseStatusResponse(channelStatsPayload);
      await this.applyLiveStatusUpdate(statusChannels);
      return;
    }

    const vodStatsPayload = parseRealtimeVodStatsPayload(parsed);
    if (!vodStatsPayload) return;

    this.lastEventAt = new Date();
    this.resetHeartbeat();
    await this.applyVodStatsUpdate(vodStatsPayload);
  }

  private async bootstrapFromRest(): Promise<void> {
    try {
      const [statusResult, vodResult] = await Promise.allSettled([
        this.client.getStatusSnapshot(),
        this.client.getVodStatsSnapshot(),
      ]);

      if (statusResult.status === 'fulfilled') {
        await this.applyLiveStatusUpdate(statusResult.value, true, false);
      } else {
        this.lastError =
          statusResult.reason instanceof Error
            ? statusResult.reason
            : new Error(String(statusResult.reason));
      }

      if (vodResult.status === 'fulfilled') {
        await this.applyVodStatsUpdate(vodResult.value, true, false);
      } else if (!this.lastError) {
        this.lastError =
          vodResult.reason instanceof Error ? vodResult.reason : new Error(String(vodResult.reason));
      }

      this.emitMergedSnapshot();
      this.lastBootstrapAt = new Date();
      this.emitStatus();
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.scheduleReconnect();
    }
  }

  private async applyLiveStatusUpdate(
    statusChannels: DispatcharrChannelStatus[],
    forceEnrichment = false,
    emitSnapshot = true
  ): Promise<void> {
    const normalizedChannels = await this.client.buildNormalizedChannelsFromStatus(
      statusChannels,
      statusChannels
    );

    await this.refreshUserCache(normalizedChannels, forceEnrichment);
    await this.refreshLogoCache(normalizedChannels);
    await this.refreshProgramCache(normalizedChannels, forceEnrichment);

    for (const channel of normalizedChannels) {
      channel.currentProgramTitle = this.programCache.get(channel.channelId);
    }

    this.latestLiveSessions = this.client.buildSessionsFromNormalizedChannels(
      normalizedChannels,
      this.userCache,
      this.logoCache
    );
    if (emitSnapshot) this.emitMergedSnapshot();
    else this.emitStatus();
  }

  private async applyVodStatsUpdate(
    vodStats: DispatcharrVodStatsResponse,
    forceUserRefresh = false,
    emitSnapshot = true
  ): Promise<void> {
    const referencedUserIds = extractReferencedVodUserIds(vodStats);
    const missingUsers = referencedUserIds.filter((id) => !this.userCache.has(id));
    if (forceUserRefresh || this.userCache.size === 0 || missingUsers.length > 0) {
      this.userCache = await this.client.getUserMap();
    }

    this.latestVodSessions = parseSessionsFromVodStats(vodStats, this.userCache, {
      ignoreAnonymousStreams: this.ignoreAnonymousStreams,
    });

    if (emitSnapshot) this.emitMergedSnapshot();
    else this.emitStatus();
  }

  private emitMergedSnapshot(): void {
    this.latestSessions = [...this.latestLiveSessions, ...this.latestVodSessions];
    this.emit('snapshot:update', { serverId: this.serverId, sessions: this.latestSessions });
    this.emitStatus();
  }

  private async refreshUserCache(
    channels: NormalizedDispatcharrChannel[],
    forceRefresh: boolean
  ): Promise<void> {
    if (forceRefresh || this.userCache.size === 0) {
      this.userCache = await this.client.getUserMap();
      return;
    }

    const userIds = extractReferencedUserIds(channels);
    const missing = userIds.filter((id) => !this.userCache.has(id));
    if (missing.length === 0) return;
    this.userCache = await this.client.getUserMap();
  }

  private async refreshLogoCache(channels: NormalizedDispatcharrChannel[]): Promise<void> {
    const missingChannelIds = channels
      .map((channel) => channel.channelId)
      .filter((channelId) => !this.logoCache.has(channelId));
    if (missingChannelIds.length === 0) return;
    const freshLogos = await this.client.getLogoPathByChannelId(missingChannelIds);
    for (const [channelId, logo] of freshLogos.entries()) {
      this.logoCache.set(channelId, logo);
    }
  }

  private async refreshProgramCache(
    channels: NormalizedDispatcharrChannel[],
    forceRefresh: boolean
  ): Promise<void> {
    const activeSetKey = channels
      .map((channel) => channel.channelId)
      .sort((a, b) => a.localeCompare(b))
      .join('|');
    if (!forceRefresh && activeSetKey === this.lastProgramSetKey) return;
    this.lastProgramSetKey = activeSetKey;
    const freshPrograms = await this.client.getCurrentProgramByChannelId(
      channels.map((channel) => channel.channelId)
    );
    this.programCache = freshPrograms;
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect) return;
    if (this.reconnectAttempts >= SSE_CONFIG.MAX_RETRIES) {
      this.activateFallback('Dispatcharr websocket max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    this.setState('reconnecting');

    const baseDelay = Math.min(
      SSE_CONFIG.INITIAL_RETRY_DELAY_MS *
        Math.pow(SSE_CONFIG.RETRY_MULTIPLIER, this.reconnectAttempts - 1),
      SSE_CONFIG.MAX_RETRY_DELAY_MS
    );
    const delay = baseDelay + Math.random() * 1000;

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
    this.emitStatus();
  }

  private activateFallback(reason: string): void {
    this.mode = 'rest-fallback';
    this.fallbackReason = reason;
    this.setState('fallback');
    this.emit('fallback:activated', {
      serverId: this.serverId,
      serverName: this.serverName,
      reason,
    });
    this.emitStatus();
  }

  private resetHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.lastError = new Error('Dispatcharr websocket heartbeat timeout');
      if (this.ws) {
        this.ws.close();
      } else {
        this.scheduleReconnect();
      }
    }, SSE_CONFIG.HEARTBEAT_TIMEOUT_MS);
  }

  private setState(state: DispatcharrRealtimeState): void {
    if (this.state !== state) {
      this.state = state;
      this.emitStatus();
    }
  }

  private emitStatus(): void {
    this.emit('connection:status', this.getStatus());
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHeartbeatTimer(): void {
    if (!this.heartbeatTimer) return;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
