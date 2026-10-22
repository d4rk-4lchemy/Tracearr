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
  const url = (method: string) => `https://api.telegram.org/bot${config.botToken}/${method}`;
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
    deliverFetch(
      url('sendMessage'),
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
    await deliverFetch(url('sendPhoto'), { method: 'POST', body: form }, ctx);
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
