import { DESTINATION_TYPES } from '@tracearr/shared';
import { formatPluginUpdateMessage } from '../formatters/pluginUpdate.js';
import {
  formatViolationDetailsForDiscord,
  getSeverityInfo,
  type DiscordField,
} from '../formatters/violation.js';
import { toNotificationPayload } from '../types.js';
import { deliverFetch } from './fetch.js';
import {
  formatDuration,
  getMediaDisplay,
  getPlaybackType,
  getUserDisplayName,
} from './sessionText.js';
import type {
  NotificationPayload,
  PluginUpdateContext,
  ServerContext,
  SessionContext,
  ViolationContext,
} from '../types.js';
import type { DeliverContext, DestinationType } from './types.js';

export interface DiscordConfig {
  webhookUrl: string;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordField[];
  timestamp?: string;
}

function buildViolationEmbed(payload: NotificationPayload, ctx: ViolationContext): DiscordEmbed {
  const { violation } = ctx;
  const { label: severityLabel, color } = getSeverityInfo(violation.severity);
  const detailFields = formatViolationDetailsForDiscord(
    violation.rule.type,
    violation.data,
    violation.userNames
  );

  return {
    title: payload.title,
    color,
    fields: [
      {
        name: 'User',
        value: violation.user.identityName ?? violation.user.username,
        inline: true,
      },
      {
        name: 'Rule',
        value: violation.rule.name,
        inline: true,
      },
      {
        name: 'Severity',
        value: severityLabel,
        inline: true,
      },
      ...detailFields,
    ],
  };
}

function buildSessionStartedEmbed(ctx: SessionContext): DiscordEmbed {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const playbackType = getPlaybackType(session);

  const fields: DiscordField[] = [
    {
      name: 'User',
      value: getUserDisplayName(session),
      inline: true,
    },
    {
      name: 'Media',
      value: mediaTitle,
      inline: true,
    },
  ];

  if (subtitle) {
    fields.push({ name: 'Episode', value: subtitle, inline: true });
  }

  fields.push({ name: 'Playback', value: playbackType, inline: true });

  if (session.geoCity && session.geoCountry) {
    fields.push({
      name: 'Location',
      value: `${session.geoCity}, ${session.geoCountry}`,
      inline: true,
    });
  }

  fields.push({
    name: 'Player',
    value: session.product || session.playerName || 'Unknown',
    inline: true,
  });

  return {
    title: 'Stream Started',
    color: 0x3498db, // Blue
    fields,
  };
}

function buildSessionStoppedEmbed(ctx: SessionContext): DiscordEmbed {
  const { session } = ctx;
  const { title: mediaTitle, subtitle } = getMediaDisplay(session);
  const durationStr = session.durationMs ? formatDuration(session.durationMs) : 'Unknown';

  const fields: DiscordField[] = [
    {
      name: 'User',
      value: getUserDisplayName(session),
      inline: true,
    },
    {
      name: 'Media',
      value: mediaTitle,
      inline: true,
    },
  ];

  if (subtitle) {
    fields.push({ name: 'Episode', value: subtitle, inline: true });
  }

  fields.push({ name: 'Duration', value: durationStr, inline: true });

  return {
    title: 'Stream Ended',
    color: 0x95a5a6, // Gray
    fields,
  };
}

function buildServerDownEmbed(ctx: ServerContext): DiscordEmbed {
  return {
    title: 'Server Connection Lost',
    description: `Lost connection to ${ctx.serverName}`,
    color: 0xff0000, // Red
  };
}

function buildServerUpEmbed(ctx: ServerContext): DiscordEmbed {
  return {
    title: 'Server Back Online',
    description: `${ctx.serverName} is back online`,
    color: 0x2ecc71, // Green
  };
}

function buildPluginUpdateEmbed(ctx: PluginUpdateContext): DiscordEmbed {
  return {
    title: 'Plugin Update Available',
    description: `${ctx.serverName}: ${formatPluginUpdateMessage(ctx)}`,
    color: 0xf39c12, // Orange/Warning
  };
}

function buildEmbed(payload: NotificationPayload): DiscordEmbed {
  switch (payload.context.type) {
    case 'violation_detected':
      return buildViolationEmbed(payload, payload.context);
    case 'stream_started':
      return buildSessionStartedEmbed(payload.context);
    case 'stream_stopped':
      return buildSessionStoppedEmbed(payload.context);
    case 'server_down':
      return buildServerDownEmbed(payload.context);
    case 'server_up':
      return buildServerUpEmbed(payload.context);
    case 'plugin_update_available':
      return buildPluginUpdateEmbed(payload.context);
  }
}

async function post(webhookUrl: string, embed: DiscordEmbed, ctx: DeliverContext): Promise<void> {
  await deliverFetch(
    webhookUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Tracearr',
        embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      }),
    },
    ctx
  );
}

export const discordType: DestinationType<DiscordConfig, DiscordEmbed> = {
  kind: 'discord',
  events: DESTINATION_TYPES.discord.events,
  render: (event, _config, ctx) => buildEmbed(toNotificationPayload(event, ctx.source)),
  deliver: (embed, config, ctx) => post(config.webhookUrl, embed, ctx),
  test: (config, ctx) =>
    post(
      config.webhookUrl,
      {
        title: 'Test Notification',
        description: 'This is a test notification from Tracearr',
        color: 0x3498db,
      },
      ctx
    ),
};
