import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  fitText,
  type NotificationPriority,
} from '@tracearr/shared';
import { deliverFetch } from './fetch.js';
import { renderText, TEST_TEXT } from './text.js';
import type { DeliverContext, DestinationType } from './types.js';

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
const PROFILE = DESTINATION_TEXT_PROFILES.pushover;
const URL_TITLE_LIMIT = { max: 100, unit: 'chars' } as const;

const PUSHOVER_PRIORITY: Record<NotificationPriority, string> = {
  lowest: '-2',
  low: '-1',
  normal: '0',
  high: '1',
  urgent: '2',
};
// Events that render their own text have no fixed alert level of their own; without one from the
// automation they go out quiet, as they did before severity drove the other destinations.
const QUIET_BY_DEFAULT = new Set([
  'media_added',
  'media_upgraded',
  'new_device',
  'trust_score_changed',
  'newsletter_send',
]);
/** Pushover refuses an emergency without these and repeats it until acknowledged. */
const EMERGENCY = { retry: '60', expire: '3600' };

export interface PushoverConfig {
  userKey: string;
  apiToken: string;
}

export interface PushoverMessage {
  title: string;
  message: string;
  priority: string;
  retry?: string;
  expire?: string;
  url?: string;
  url_title?: string;
}

async function post(
  config: PushoverConfig,
  body: PushoverMessage,
  ctx: DeliverContext
): Promise<void> {
  const params = new URLSearchParams({
    token: config.apiToken,
    user: config.userKey,
    title: body.title,
    message: body.message,
    priority: body.priority,
  });
  if (body.retry !== undefined && body.expire !== undefined) {
    params.set('retry', body.retry);
    params.set('expire', body.expire);
  }
  if (body.url !== undefined) params.set('url', body.url);
  if (body.url_title !== undefined) params.set('url_title', body.url_title);

  await deliverFetch(
    PUSHOVER_API_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    ctx
  );
}

export const pushoverType: DestinationType<PushoverConfig, PushoverMessage> = {
  kind: 'pushover',
  events: DESTINATION_TYPES.pushover.events,
  render: async (event, _config, ctx) => {
    const { text, priority, links, payload } = await renderText(event, ctx.source, PROFILE);
    const link = links[0];
    const level =
      payload.automation?.priority ??
      (QUIET_BY_DEFAULT.has(payload.context.type) ? 'low' : priority);
    return {
      ...text,
      priority: PUSHOVER_PRIORITY[level],
      ...(level === 'urgent' && EMERGENCY),
      ...(link && { url: link.url, url_title: fitText(link.label, URL_TITLE_LIMIT) }),
    };
  },
  deliver: (body, config, ctx) => post(config, body, ctx),
  test: (config, ctx) => post(config, { ...TEST_TEXT, priority: PUSHOVER_PRIORITY.low }, ctx),
};
