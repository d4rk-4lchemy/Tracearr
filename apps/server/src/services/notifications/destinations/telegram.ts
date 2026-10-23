import { UnrecoverableError } from 'bullmq';
import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  fitText,
  isPubliclyRoutableUrl,
} from '@tracearr/shared';
import { deliverFetch } from './fetch.js';
import { fetchPoster, posterFilename, type Poster } from './poster.js';
import { renderText, TEST_TEXT } from './text.js';
import type { MediaLink } from '../mediaLinks.js';
import type { DeliverContext, DestinationType } from './types.js';

const PROFILE = DESTINATION_TEXT_PROFILES.telegram;
/** A photo caption is capped at 1024: the 256 title, the newline, and this. */
const CAPTION_BODY = { max: 767, unit: 'bytes' } as const;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  topicId?: string;
}

export interface TelegramMessage {
  title: string;
  message: string;
  silent: boolean;
  links: MediaLink[];
  poster?: Poster;
}

interface TelegramFailure {
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

function parseFailure(body: string | undefined): TelegramFailure {
  try {
    return JSON.parse(body ?? '') as TelegramFailure;
  } catch {
    return {};
  }
}

/**
 * Rethrows a refused call with Telegram's own description. A 429 carries `retryAfterMs` for
 * the queue to wait out; any other 4xx is the token, the chat or the message and cannot
 * succeed on retry, so it fails without spending the remaining attempts.
 */
async function call(
  config: TelegramConfig,
  method: string,
  init: Parameters<typeof deliverFetch>[1],
  ctx: DeliverContext
): Promise<void> {
  try {
    await deliverFetch(`https://api.telegram.org/bot${config.botToken}/${method}`, init, ctx);
  } catch (error) {
    const { status, body } = error as { status?: number; body?: string };
    if (status === undefined) throw error;
    const { description, parameters } = parseFailure(body);
    let message = `${ctx.destination.name}: ${status} ${description ?? 'no description'}`;
    if (parameters?.migrate_to_chat_id !== undefined) {
      message += `. The group is now a supergroup with chat ID ${parameters.migrate_to_chat_id}; update the destination to use it.`;
    } else if (status === 401 || status === 404) {
      message += '. Check the bot token.';
    }
    if (status === 429 || status >= 500) {
      throw Object.assign(new Error(message, { cause: error }), {
        status,
        ...(parameters?.retry_after !== undefined && {
          retryAfterMs: parameters.retry_after * 1000,
        }),
      });
    }
    throw Object.assign(new UnrecoverableError(message), { status, cause: error });
  }
}

/**
 * The title is bolded by entity rather than parse_mode, so the text needs no escaping.
 * A poster goes as sendPhoto multipart with Content-Type left unset so undici writes
 * the boundary itself. When Telegram refuses the photo (a 400 on the upload itself)
 * the message goes again as plain text so the alert still arrives.
 */
async function post(
  config: TelegramConfig,
  body: TelegramMessage,
  ctx: DeliverContext
): Promise<void> {
  const text = `${body.title}\n${body.message}`;
  const entities = [{ type: 'bold', offset: 0, length: body.title.length }];
  const fields = {
    chat_id: config.chatId,
    disable_notification: body.silent,
    ...(config.topicId && { message_thread_id: Number(config.topicId) }),
    ...(body.links.length > 0 && {
      reply_markup: { inline_keyboard: [body.links.map((l) => ({ text: l.label, url: l.url }))] },
    }),
  };

  const sendMessage = () =>
    call(
      config,
      'sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          text,
          entities,
          link_preview_options: { is_disabled: true },
        }),
      },
      ctx
    );

  if (!body.poster) return sendMessage();

  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, caption: text })) {
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  form.append('caption_entities', JSON.stringify(entities));
  form.append(
    'photo',
    new Blob([new Uint8Array(body.poster.data)], { type: body.poster.contentType }),
    posterFilename(body.poster.contentType)
  );
  try {
    await call(config, 'sendPhoto', { method: 'POST', body: form }, ctx);
  } catch (error) {
    if ((error as { status?: number }).status !== 400) throw error;
    await sendMessage();
  }
}

export const telegramType: DestinationType<TelegramConfig, TelegramMessage> = {
  kind: 'telegram',
  events: DESTINATION_TYPES.telegram.events,
  render: async (event, _config, ctx) => {
    const { text, priority, links, payload } = await renderText(event, ctx.source, PROFILE);
    const { context } = payload;
    const poster =
      context.type === 'media_added' || context.type === 'media_upgraded'
        ? await fetchPoster(context.serverId, context.thumbPath)
        : undefined;
    return {
      ...text,
      silent: priority === 'lowest' || priority === 'low',
      links: links.filter((l) => isPubliclyRoutableUrl(l.url)),
      ...(poster && { poster, message: fitText(text.message, CAPTION_BODY) }),
    };
  },
  deliver: (body, config, ctx) => post(config, body, ctx),
  test: (config, ctx) => post(config, { ...TEST_TEXT, silent: false, links: [] }, ctx),
};
