/**
 * Notification payload types shared by every destination type module.
 */

import type { ViolationWithDetails, ActiveSession, NotificationEventType } from '@tracearr/shared';
import type { NotificationEvent, NotificationSource } from './events.js';

// Re-export for convenience
export type { ViolationWithDetails, ActiveSession, NotificationEventType };

/**
 * Severity levels for notifications
 */
export type NotificationSeverity = 'low' | 'warning' | 'high';

/**
 * Context provided with violation notifications
 */
export interface ViolationContext {
  type: 'violation_detected';
  violation: ViolationWithDetails;
}

/**
 * Context provided with session notifications
 */
export interface SessionContext {
  type: 'stream_started' | 'stream_stopped';
  session: ActiveSession;
}

/**
 * Context provided with server status notifications
 */
export interface ServerContext {
  type: 'server_down' | 'server_up';
  serverName: string;
  serverType?: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr';
}

/**
 * Context provided with plugin update notifications
 */
export interface PluginUpdateContext {
  type: 'plugin_update_available';
  serverId: string;
  serverName: string;
  serverType: string;
  installedVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
}

/**
 * Context provided with plugin update notifications
 */
export interface PluginUpdateContext {
  type: 'plugin_update_available';
  serverId: string;
  serverName: string;
  serverType: string;
  installedVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
}

/**
 * Union of all notification contexts
 */
export type NotificationContext =
  ViolationContext | SessionContext | ServerContext | PluginUpdateContext;

/**
 * Unified notification payload for all agents
 */
export interface NotificationPayload {
  /** Event type identifier */
  event: NotificationEventType;

  /** Human-readable title */
  title: string;

  /** Human-readable message body */
  message: string;

  /** Severity level (affects priority in some agents) */
  severity: NotificationSeverity;

  /** ISO timestamp */
  timestamp: string;

  /** Additional context based on event type */
  context: NotificationContext;

  /** Optional image URL (e.g., poster) */
  imageUrl?: string;
}

/**
 * Payload builders for creating NotificationPayload from raw data
 */
export const PayloadBuilders = {
  fromViolation(violation: ViolationWithDetails): NotificationPayload {
    const userName = violation.user.identityName ?? violation.user.username;
    return {
      event: 'violation_detected',
      title: 'Violation Detected',
      message: `User ${userName} triggered a rule violation`,
      severity: violation.severity,
      timestamp: new Date().toISOString(),
      context: { type: 'violation_detected', violation },
    };
  },

  fromSessionStarted(session: ActiveSession): NotificationPayload {
    const userName = session.user.identityName ?? session.user.username;
    return {
      event: 'stream_started',
      title: 'Stream Started',
      message: `${userName} started streaming`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'stream_started', session },
    };
  },

  fromSessionStopped(session: ActiveSession): NotificationPayload {
    const userName = session.user.identityName ?? session.user.username;
    return {
      event: 'stream_stopped',
      title: 'Stream Stopped',
      message: `${userName} stopped streaming`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'stream_stopped', session },
    };
  },

  fromServerDown(
    serverName: string,
    serverType?: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr'
  ): NotificationPayload {
    return {
      event: 'server_down',
      title: 'Server Offline',
      message: `${serverName} is not responding`,
      severity: 'high',
      timestamp: new Date().toISOString(),
      context: { type: 'server_down', serverName, serverType },
    };
  },

  fromServerUp(
    serverName: string,
    serverType?: 'plex' | 'jellyfin' | 'emby' | 'dispatcharr'
  ): NotificationPayload {
    return {
      event: 'server_up',
      title: 'Server Online',
      message: `${serverName} is back online`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: { type: 'server_up', serverName, serverType },
    };
  },

  fromPluginUpdate(
    serverId: string,
    serverName: string,
    serverType: string,
    installedVersion: string | null,
    latestVersion: string,
    downloadUrl: string
  ): NotificationPayload {
    const installed = installedVersion ?? 'pre-0.2.0';
    return {
      event: 'plugin_update_available',
      title: 'Plugin Update Available',
      message: `${serverName} plugin is outdated (installed ${installed}, latest ${latestVersion})`,
      severity: 'low',
      timestamp: new Date().toISOString(),
      context: {
        type: 'plugin_update_available',
        serverId,
        serverName,
        serverType,
        installedVersion,
        latestVersion,
        downloadUrl,
      },
    };
  },
};

/** One NotificationPayload per event; a rule send carries its own title and message. */
export function toNotificationPayload(
  event: NotificationEvent,
  source: NotificationSource
): NotificationPayload {
  const base = ((): NotificationPayload => {
    switch (event.type) {
      case 'violation':
        return PayloadBuilders.fromViolation(event.payload);
      case 'session_started':
        return PayloadBuilders.fromSessionStarted(event.payload);
      case 'session_stopped':
        return PayloadBuilders.fromSessionStopped(event.payload);
      case 'server_down':
        return PayloadBuilders.fromServerDown(event.payload.serverName);
      case 'server_up':
        return PayloadBuilders.fromServerUp(event.payload.serverName);
      case 'plugin_update_available': {
        const p = event.payload;
        return PayloadBuilders.fromPluginUpdate(
          p.serverId,
          p.serverName,
          p.serverType,
          p.installedVersion,
          p.latestVersion,
          p.downloadUrl
        );
      }
    }
  })();
  if (source.kind === 'rule') {
    return { ...base, title: source.title, message: source.message };
  }
  return base;
}
