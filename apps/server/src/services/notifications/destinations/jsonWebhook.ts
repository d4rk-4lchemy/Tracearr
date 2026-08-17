import { DESTINATION_TYPES, NOTIFICATION_EVENTS } from '@tracearr/shared';
import { toNotificationPayload } from '../types.js';
import { deliverFetch } from './fetch.js';
import { getMediaDisplay, getPlaybackType, getUserDisplayName } from './sessionText.js';
import type {
  NotificationPayload,
  PluginUpdateContext,
  ServerContext,
  SessionContext,
  ViolationContext,
} from '../types.js';
import type { DeliverContext, DestinationType } from './types.js';

export interface JsonWebhookConfig {
  url: string;
}

export interface JsonWebhookBody {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function buildViolation(payload: NotificationPayload, ctx: ViolationContext): JsonWebhookBody {
  const { violation } = ctx;
  return {
    event: NOTIFICATION_EVENTS.VIOLATION_DETECTED,
    timestamp: payload.timestamp,
    data: {
      user: {
        id: violation.serverUserId,
        username: violation.user.username,
        displayName: violation.user.identityName ?? violation.user.username,
      },
      rule: {
        id: violation.ruleId,
        type: violation.rule.type,
        name: violation.rule.name,
      },
      violation: {
        id: violation.id,
        severity: violation.severity,
        details: violation.data,
      },
    },
  };
}

function buildSessionStarted(payload: NotificationPayload, ctx: SessionContext): JsonWebhookBody {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const playbackType = getPlaybackType(session);

  return {
    event: NOTIFICATION_EVENTS.STREAM_STARTED,
    timestamp: payload.timestamp,
    data: {
      user: {
        id: session.serverUserId,
        username: session.user.username,
        displayName: getUserDisplayName(session),
      },
      media: {
        title: mediaTitle,
        subtitle,
        type: session.mediaType,
        year: session.year,
        mediaId: session.mediaId ?? null,
        imdbId: session.imdbId ?? null,
        tmdbId: session.tmdbId ?? null,
        tvdbId: session.tvdbId ?? null,
        ratingKey: session.ratingKey || null,
        parentRatingKey: session.parentRatingKey ?? null,
        grandparentRatingKey: session.grandparentRatingKey ?? null,
      },
      playback: {
        type: playbackType,
        quality: session.quality,
        player: session.product || session.playerName,
      },
      location: {
        city: session.geoCity,
        country: session.geoCountry,
      },
    },
  };
}

function buildSessionStopped(payload: NotificationPayload, ctx: SessionContext): JsonWebhookBody {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);

  return {
    event: NOTIFICATION_EVENTS.STREAM_STOPPED,
    timestamp: payload.timestamp,
    data: {
      user: {
        id: session.serverUserId,
        username: session.user.username,
        displayName: getUserDisplayName(session),
      },
      media: {
        title: mediaTitle,
        subtitle,
        type: session.mediaType,
        mediaId: session.mediaId ?? null,
        imdbId: session.imdbId ?? null,
        tmdbId: session.tmdbId ?? null,
        tvdbId: session.tvdbId ?? null,
        ratingKey: session.ratingKey || null,
        parentRatingKey: session.parentRatingKey ?? null,
        grandparentRatingKey: session.grandparentRatingKey ?? null,
      },
      session: {
        durationMs: session.durationMs,
      },
    },
  };
}

function buildServer(payload: NotificationPayload, ctx: ServerContext): JsonWebhookBody {
  const event =
    ctx.type === 'server_down' ? NOTIFICATION_EVENTS.SERVER_DOWN : NOTIFICATION_EVENTS.SERVER_UP;

  return {
    event,
    timestamp: payload.timestamp,
    data: {
      serverName: ctx.serverName,
      serverType: ctx.serverType,
    },
  };
}

function buildPluginUpdate(
  payload: NotificationPayload,
  ctx: PluginUpdateContext
): JsonWebhookBody {
  return {
    event: NOTIFICATION_EVENTS.PLUGIN_UPDATE_AVAILABLE,
    timestamp: payload.timestamp,
    data: {
      serverId: ctx.serverId,
      serverName: ctx.serverName,
      serverType: ctx.serverType,
      installedVersion: ctx.installedVersion,
      latestVersion: ctx.latestVersion,
      downloadUrl: ctx.downloadUrl,
    },
  };
}

function build(payload: NotificationPayload): JsonWebhookBody {
  switch (payload.context.type) {
    case 'violation_detected':
      return buildViolation(payload, payload.context);
    case 'stream_started':
      return buildSessionStarted(payload, payload.context);
    case 'stream_stopped':
      return buildSessionStopped(payload, payload.context);
    case 'server_down':
      return buildServer(payload, payload.context);
    case 'server_up':
      return buildServer(payload, payload.context);
    case 'plugin_update_available':
      return buildPluginUpdate(payload, payload.context);
  }
}

async function post(url: string, body: JsonWebhookBody, ctx: DeliverContext): Promise<void> {
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

export const jsonWebhookType: DestinationType<JsonWebhookConfig, JsonWebhookBody> = {
  kind: 'json_webhook',
  events: DESTINATION_TYPES.json_webhook.events,
  render: (event, _config, ctx) => build(toNotificationPayload(event, ctx.source)),
  deliver: (body, config, ctx) => post(config.url, body, ctx),
  test: (config, ctx) =>
    post(
      config.url,
      {
        event: 'test',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test notification from Tracearr' },
      },
      ctx
    ),
};
