import { DESTINATION_TEXT_PROFILES, DESTINATION_TYPES } from '@tracearr/shared';
import { deliverFetch } from './fetch.js';
import { renderText, TEST_TEXT } from './text.js';
import type { NotificationSeverity } from '../types.js';
import type { DeliverContext, DestinationType } from './types.js';

const PROFILE = DESTINATION_TEXT_PROFILES.apprise;

export interface AppriseConfig {
  url: string;
}

export type AppriseType = 'info' | 'success' | 'warning' | 'failure';

export interface AppriseMessage {
  title: string;
  body: string;
  type: AppriseType;
  format: 'text';
}

const SEVERITY_TYPE: Record<NotificationSeverity, AppriseType> = {
  high: 'failure',
  warning: 'warning',
  low: 'info',
};

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
  render: async (event, _config, ctx) => {
    const { text, payload } = await renderText(event, ctx.source, PROFILE, { links: false });
    return {
      title: text.title,
      body: text.message,
      type: SEVERITY_TYPE[payload.severity],
      format: 'text',
    };
  },
  deliver: (body, config, ctx) => post(config.url, body, ctx),
  test: (config, ctx) =>
    post(
      config.url,
      { title: TEST_TEXT.title, body: TEST_TEXT.message, type: 'info', format: 'text' },
      ctx
    ),
};
