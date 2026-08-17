import { DESTINATION_TYPES } from '@tracearr/shared';
import { formatPluginUpdateMessage } from '../formatters/pluginUpdate.js';
import { formatViolationMessage } from '../formatters/violation.js';
import { toNotificationPayload } from '../types.js';
import { deliverFetch } from './fetch.js';
import { formatDuration, getMediaDisplay, getUserDisplayName } from './sessionText.js';
import type {
  NotificationPayload,
  PluginUpdateContext,
  ServerContext,
  SessionContext,
  ViolationContext,
} from '../types.js';
import type { DeliverContext, DestinationType } from './types.js';

export interface NtfyConfig {
  url: string;
  topic: string;
  authToken?: string | null;
}

export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
}

function severityToPriority(severity: string): number {
  const map: Record<string, number> = { high: 5, warning: 4, low: 3 };
  return map[severity] ?? 3;
}

function buildViolation(
  payload: NotificationPayload,
  topic: string,
  ctx: ViolationContext
): NtfyMessage {
  return {
    topic,
    title: payload.title,
    message: formatViolationMessage(ctx.violation),
    priority: severityToPriority(ctx.violation.severity),
    tags: ['tracearr'],
  };
}

function buildSessionStarted(topic: string, ctx: SessionContext): NtfyMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;

  return {
    topic,
    title: 'Stream Started',
    message: `${userName} started watching ${mediaDisplay}`,
    priority: 3,
    tags: ['tracearr'],
  };
}

function buildSessionStopped(topic: string, ctx: SessionContext): NtfyMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;
  const durationStr = session.durationMs ? ` (${formatDuration(session.durationMs)})` : '';

  return {
    topic,
    title: 'Stream Ended',
    message: `${userName} finished watching ${mediaDisplay}${durationStr}`,
    priority: 3,
    tags: ['tracearr'],
  };
}

function buildServerDown(topic: string, ctx: ServerContext): NtfyMessage {
  return {
    topic,
    title: 'Server Offline',
    message: `${ctx.serverName} is not responding`,
    priority: 5,
    tags: ['tracearr'],
  };
}

function buildServerUp(topic: string, ctx: ServerContext): NtfyMessage {
  return {
    topic,
    title: 'Server Online',
    message: `${ctx.serverName} is back online`,
    priority: 4,
    tags: ['tracearr'],
  };
}

function buildPluginUpdate(topic: string, ctx: PluginUpdateContext): NtfyMessage {
  return {
    topic,
    title: 'Plugin Update Available',
    message: `${ctx.serverName}: ${formatPluginUpdateMessage(ctx)}`,
    priority: 3,
    tags: ['tracearr'],
  };
}

function build(payload: NotificationPayload, topic: string): NtfyMessage {
  switch (payload.context.type) {
    case 'violation_detected':
      return buildViolation(payload, topic, payload.context);
    case 'stream_started':
      return buildSessionStarted(topic, payload.context);
    case 'stream_stopped':
      return buildSessionStopped(topic, payload.context);
    case 'server_down':
      return buildServerDown(topic, payload.context);
    case 'server_up':
      return buildServerUp(topic, payload.context);
    case 'plugin_update_available':
      return buildPluginUpdate(topic, payload.context);
  }
}

async function post(config: NtfyConfig, body: NtfyMessage, ctx: DeliverContext): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }
  await deliverFetch(config.url, { method: 'POST', headers, body: JSON.stringify(body) }, ctx);
}

export const ntfyType: DestinationType<NtfyConfig, NtfyMessage> = {
  kind: 'ntfy',
  events: DESTINATION_TYPES.ntfy.events,
  render: (event, config, ctx) =>
    build(toNotificationPayload(event, ctx.source), config.topic || 'tracearr'),
  deliver: (body, config, ctx) => post(config, body, ctx),
  test: (config, ctx) =>
    post(
      config,
      {
        topic: config.topic || 'tracearr',
        title: 'Test Notification',
        message: 'This is a test notification from Tracearr',
        priority: 3,
        tags: ['tracearr'],
      },
      ctx
    ),
};
