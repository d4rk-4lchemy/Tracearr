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

export interface AppriseConfig {
  url: string;
}

export type AppriseType = 'info' | 'success' | 'warning' | 'failure';

export interface AppriseMessage {
  title: string;
  body: string;
  type: AppriseType;
}

function severityToType(severity: string): AppriseType {
  const map: Record<string, AppriseType> = {
    high: 'failure',
    warning: 'warning',
    low: 'info',
  };
  return map[severity] ?? 'info';
}

function buildViolation(payload: NotificationPayload, ctx: ViolationContext): AppriseMessage {
  return {
    title: payload.title,
    body: formatViolationMessage(ctx.violation),
    type: severityToType(ctx.violation.severity),
  };
}

function buildSessionStarted(ctx: SessionContext): AppriseMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;

  return {
    title: 'Stream Started',
    body: `${userName} started watching ${mediaDisplay}`,
    type: 'info',
  };
}

function buildSessionStopped(ctx: SessionContext): AppriseMessage {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const userName = getUserDisplayName(session);
  const mediaDisplay = subtitle ? `${mediaTitle} - ${subtitle}` : mediaTitle;
  const durationStr = session.durationMs ? ` (${formatDuration(session.durationMs)})` : '';

  return {
    title: 'Stream Ended',
    body: `${userName} finished watching ${mediaDisplay}${durationStr}`,
    type: 'info',
  };
}

function buildServerDown(ctx: ServerContext): AppriseMessage {
  return {
    title: 'Server Offline',
    body: `${ctx.serverName} is not responding`,
    type: 'failure',
  };
}

function buildServerUp(ctx: ServerContext): AppriseMessage {
  return {
    title: 'Server Online',
    body: `${ctx.serverName} is back online`,
    type: 'success',
  };
}

function buildPluginUpdate(ctx: PluginUpdateContext): AppriseMessage {
  return {
    title: 'Plugin Update Available',
    body: `${ctx.serverName}: ${formatPluginUpdateMessage(ctx)}`,
    type: 'warning',
  };
}

function build(payload: NotificationPayload): AppriseMessage {
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

async function post(url: string, body: AppriseMessage, ctx: DeliverContext): Promise<void> {
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

export const appriseType: DestinationType<AppriseConfig, AppriseMessage> = {
  kind: 'apprise',
  events: DESTINATION_TYPES.apprise.events,
  render: (event, _config, ctx) => build(toNotificationPayload(event, ctx.source)),
  deliver: (body, config, ctx) => post(config.url, body, ctx),
  test: (config, ctx) =>
    post(
      config.url,
      {
        title: 'Test Notification',
        body: 'This is a test notification from Tracearr',
        type: 'info',
      },
      ctx
    ),
};
