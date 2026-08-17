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

export interface GotifyConfig {
  url: string;
}

export interface GotifyMessage {
  title: string;
  message: string;
  priority: number;
}

function severityToPriority(severity: string): number {
  const map: Record<string, number> = { high: 5, warning: 4, low: 3 };
  return map[severity] ?? 3;
}

function buildViolation(payload: NotificationPayload, ctx: ViolationContext): GotifyMessage {
  return {
    title: payload.title,
    message: formatViolationMessage(ctx.violation),
    priority: severityToPriority(ctx.violation.severity),
  };
}

function buildSessionStarted(ctx: SessionContext): GotifyMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;

  return {
    title: 'Stream Started',
    message: `${userName} started watching ${mediaDisplay}`,
    priority: 3,
  };
}

function buildSessionStopped(ctx: SessionContext): GotifyMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;
  const durationStr = session.durationMs ? ` (${formatDuration(session.durationMs)})` : '';

  return {
    title: 'Stream Ended',
    message: `${userName} finished watching ${mediaDisplay}${durationStr}`,
    priority: 3,
  };
}

function buildServerDown(ctx: ServerContext): GotifyMessage {
  return {
    title: 'Server Offline',
    message: `${ctx.serverName} is not responding`,
    priority: 5,
  };
}

function buildServerUp(ctx: ServerContext): GotifyMessage {
  return {
    title: 'Server Online',
    message: `${ctx.serverName} is back online`,
    priority: 4,
  };
}

function buildPluginUpdate(ctx: PluginUpdateContext): GotifyMessage {
  return {
    title: 'Plugin Update Available',
    message: `${ctx.serverName}: ${formatPluginUpdateMessage(ctx)}`,
    priority: 3,
  };
}

function build(payload: NotificationPayload): GotifyMessage {
  switch (payload.context.type) {
    case 'violation_detected':
      return buildViolation(payload, payload.context);
    case 'stream_started':
      return buildSessionStarted(payload.context);
    case 'stream_stopped':
      return buildSessionStopped(payload.context);
    case 'server_down':
      return buildServerDown(payload.context);
    case 'server_up':
      return buildServerUp(payload.context);
    case 'plugin_update_available':
      return buildPluginUpdate(payload.context);
  }
}

async function post(url: string, body: GotifyMessage, ctx: DeliverContext): Promise<void> {
  await deliverFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    ctx
  );
}

export const gotifyType: DestinationType<GotifyConfig, GotifyMessage> = {
  kind: 'gotify',
  events: DESTINATION_TYPES.gotify.events,
  render: (event, _config, ctx) => build(toNotificationPayload(event, ctx.source)),
  deliver: (body, config, ctx) => post(config.url, body, ctx),
  test: (config, ctx) =>
    post(
      config.url,
      {
        title: 'Test Notification',
        message: 'This is a test notification from Tracearr',
        priority: 3,
      },
      ctx
    ),
};
