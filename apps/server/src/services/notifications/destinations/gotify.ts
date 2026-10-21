import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  type NotificationPriority,
} from '@tracearr/shared';
import { deliverFetch } from './fetch.js';
import { renderText, TEST_TEXT } from './text.js';
import type { DeliverContext, DestinationType } from './types.js';

const PROFILE = DESTINATION_TEXT_PROFILES.gotify;

const GOTIFY_PRIORITY: Record<NotificationPriority, number> = {
  lowest: 0,
  low: 2,
  normal: 5,
  high: 8,
  urgent: 10,
};

export interface GotifyConfig {
  url: string;
}

export interface GotifyMessage {
  title: string;
  message: string;
  priority: number;
  extras?: { 'client::notification': { click: { url: string } } };
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
  render: async (event, _config, ctx) => {
    const { text, priority, links } = await renderText(event, ctx.source, PROFILE);
    const url = links[0]?.url;
    return {
      ...text,
      priority: GOTIFY_PRIORITY[priority],
      ...(url !== undefined && { extras: { 'client::notification': { click: { url } } } }),
    };
  },
  deliver: (body, config, ctx) => post(config.url, body, ctx),
  test: (config, ctx) => post(config.url, { ...TEST_TEXT, priority: GOTIFY_PRIORITY.normal }, ctx),
};
