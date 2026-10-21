import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  type NotificationPriority,
} from '@tracearr/shared';
import { deliverFetch } from './fetch.js';
import { renderText, TEST_TEXT } from './text.js';
import type { DeliverContext, DestinationType } from './types.js';

const PROFILE = DESTINATION_TEXT_PROFILES.ntfy;

const NTFY_PRIORITY: Record<NotificationPriority, number> = {
  lowest: 1,
  low: 2,
  normal: 3,
  high: 4,
  urgent: 5,
};

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
  click?: string;
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
  render: async (event, config, ctx) => {
    const { text, priority, links } = await renderText(event, ctx.source, PROFILE);
    const click = links[0]?.url;
    return {
      topic: config.topic || 'tracearr',
      ...text,
      priority: NTFY_PRIORITY[priority],
      tags: ['tracearr'],
      ...(click !== undefined && { click }),
    };
  },
  deliver: (body, config, ctx) => post(config, body, ctx),
  test: (config, ctx) =>
    post(
      config,
      {
        topic: config.topic || 'tracearr',
        ...TEST_TEXT,
        priority: NTFY_PRIORITY.normal,
        tags: ['tracearr'],
      },
      ctx
    ),
};
