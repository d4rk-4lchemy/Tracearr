import { afterEach, describe, expect, it, vi } from 'vitest';
import { textSize, type NotificationPriority } from '@tracearr/shared';

const mockProxyImage = vi.fn();
vi.mock('../../imageProxy.js', () => ({
  proxyImage: (...args: unknown[]) => mockProxyImage(...args) as unknown,
}));

const mockBuildMediaLinks = vi.fn();
vi.mock('../mediaLinks.js', () => ({
  buildMediaLinks: (...args: unknown[]) => mockBuildMediaLinks(...args) as unknown,
}));

import {
  telegramType,
  type TelegramConfig,
  type TelegramMessage,
} from '../destinations/telegram.js';
import { mediaUpgraded, session } from './fixtures.js';
import type { NotificationEvent, NotificationSource } from '../events.js';
import type { RenderContext } from '../destinations/types.js';

const links = [
  { label: 'Tracearr', url: 'https://t.example/m/1' },
  { label: 'Plex', url: 'https://plex.example/i' },
];
mockBuildMediaLinks.mockResolvedValue(links);

const config: TelegramConfig = { botToken: '123:abc', chatId: '-1001234567890' };
const destination = { id: 'dest-1', name: 'My Telegram' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const withThumb = {
  ...mediaUpgraded,
  payload: { ...mediaUpgraded.payload, thumbPath: '/library/metadata/1/thumb' },
} as NotificationEvent;

const automationCtx = (
  over: { priority?: NotificationPriority; title?: string; body?: string } = {}
): RenderContext => ({
  destination,
  source: {
    kind: 'automation',
    automationId: 'a-1',
    automationName: 'Now playing',
    ...over,
  } as NotificationSource,
});

const render = async (
  event: NotificationEvent,
  ctx: RenderContext = systemCtx
): Promise<TelegramMessage> => telegramType.render(event, config, ctx);

const sentBody = (f: ReturnType<typeof vi.fn>): Record<string, unknown> =>
  JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
    string,
    unknown
  >;

const okFetch = () => {
  const f = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', f);
  return f;
};

describe('telegramType.render', () => {
  it('is silent for low severity and audible for high', async () => {
    const stream = await render({ type: 'session_started', payload: session });
    expect(stream).toEqual({
      title: 'Stream Started',
      message: 'testuser started watching Test Movie - 2024',
      silent: true,
      links: [],
    });
    const down = await render({
      type: 'server_down',
      payload: { serverName: 'Plex', serverId: 's1' },
    });
    expect(down.silent).toBe(false);
  });

  it('is silent only for lowest and low from an automation', async () => {
    for (const p of ['lowest', 'low', 'normal', 'high', 'urgent'] as const) {
      const r = await render(
        { type: 'session_started', payload: session },
        automationCtx({ priority: p })
      );
      expect(r.silent).toBe(p === 'lowest' || p === 'low');
    }
  });

  it('carries the media links as buttons on a media event', async () => {
    const r = await render(mediaUpgraded);
    expect(r.links).toEqual(links);
  });

  it('fetches the poster on a media event and refits the body to the caption limit', async () => {
    const poster = { data: Buffer.from('img'), contentType: 'image/webp' };
    mockProxyImage.mockReset().mockResolvedValue(poster);
    const r = await render(withThumb, automationCtx({ body: 'x'.repeat(2000) }));
    expect(r.poster).toEqual(poster);
    expect(textSize(r.message, 'bytes')).toBeLessThanOrEqual(767);

    mockProxyImage.mockClear();
    const stream = await render({ type: 'session_started', payload: session });
    expect(stream.poster).toBeUndefined();
    expect(mockProxyImage).not.toHaveBeenCalled();
  });

  it('sends plain text when the poster fetch fails', async () => {
    mockProxyImage.mockReset().mockRejectedValue(new Error('unreachable'));
    const r = await render(withThumb, automationCtx({ body: 'x'.repeat(5000) }));
    expect(r.poster).toBeUndefined();
    expect(textSize(r.message, 'bytes')).toBe(3839);
  });

  it('keeps emoji text inside 4096 utf-16 units', async () => {
    const wave = '👋'.repeat(2000);
    const r = await render(
      { type: 'session_started', payload: session },
      automationCtx({ title: wave, body: wave })
    );
    expect(`${r.title}\n${r.message}`.length).toBeLessThanOrEqual(4096);
  });
});

describe('telegramType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a bold title and the message to sendMessage', async () => {
    const f = okFetch();
    const title = 'Hi <b>&</b> 👋';
    await telegramType.deliver(
      { title, message: 'body *x*', silent: false, links: [] },
      config,
      deliverCtx
    );
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '-1001234567890',
      text: `${title}\nbody *x*`,
      entities: [{ type: 'bold', offset: 0, length: title.length }],
      disable_notification: false,
      link_preview_options: { is_disabled: true },
    });
  });

  it('passes an @channel chat id through and sends the topic as a number', async () => {
    const f = okFetch();
    await telegramType.deliver(
      { title: 't', message: 'm', silent: false, links: [] },
      { ...config, chatId: '@mychannel', topicId: '42' },
      deliverCtx
    );
    const body = sentBody(f);
    expect(body.chat_id).toBe('@mychannel');
    expect(body.message_thread_id).toBe(42);
  });

  it('leaves message_thread_id out when the topic is blank', async () => {
    const f = okFetch();
    await telegramType.deliver(
      { title: 't', message: 'm', silent: false, links: [] },
      { ...config, topicId: '' },
      deliverCtx
    );
    expect(sentBody(f)).not.toHaveProperty('message_thread_id');
  });

  it('throws with the description when telegram rejects the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}', {
          status: 400,
        })
      )
    );
    await expect(
      telegramType.deliver(
        { title: 't', message: 'm', silent: false, links: [] },
        config,
        deliverCtx
      )
    ).rejects.toThrow('chat not found');
  });

  it('adds one inline keyboard row when links are present and none otherwise', async () => {
    const f = okFetch();
    await telegramType.deliver(
      { title: 't', message: 'm', silent: false, links },
      config,
      deliverCtx
    );
    expect(sentBody(f).reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Tracearr', url: 'https://t.example/m/1' },
          { text: 'Plex', url: 'https://plex.example/i' },
        ],
      ],
    });

    f.mockClear();
    await telegramType.deliver(
      { title: 't', message: 'm', silent: false, links: [] },
      config,
      deliverCtx
    );
    expect(sentBody(f)).not.toHaveProperty('reply_markup');
  });

  it('uploads the poster as sendPhoto multipart with the caption and entities', async () => {
    const f = okFetch();
    const poster = { data: Buffer.from('img'), contentType: 'image/webp' };
    await telegramType.deliver(
      { title: 'T', message: 'm', silent: true, links: [], poster },
      { ...config, topicId: '7' },
      deliverCtx
    );
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendPhoto');
    expect(init.headers ?? {}).not.toHaveProperty('Content-Type');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('chat_id')).toBe('-1001234567890');
    expect(form.get('caption')).toBe('T\nm');
    expect(JSON.parse(form.get('caption_entities') as string)).toEqual([
      { type: 'bold', offset: 0, length: 1 },
    ]);
    expect(form.get('disable_notification')).toBe('true');
    expect(form.get('message_thread_id')).toBe('7');
    expect(form.has('reply_markup')).toBe(false);
    const photo = form.get('photo') as File;
    expect(photo).toBeInstanceOf(Blob);
    expect(photo.name).toBe('poster.webp');
  });

  it('sends two links as one keyboard row with the photo', async () => {
    const f = okFetch();
    const poster = { data: Buffer.from('img'), contentType: 'image/webp' };
    await telegramType.deliver(
      { title: 'T', message: 'm', silent: false, links, poster },
      config,
      deliverCtx
    );
    const form = (f.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(JSON.parse(form.get('reply_markup') as string)).toEqual({
      inline_keyboard: [
        [
          { text: 'Tracearr', url: 'https://t.example/m/1' },
          { text: 'Plex', url: 'https://plex.example/i' },
        ],
      ],
    });
  });

  it('posts the test message audibly', async () => {
    const f = okFetch();
    await telegramType.test(config, deliverCtx);
    const body = sentBody(f);
    expect(body.text).toBe('Test Notification\nThis is a test notification from Tracearr');
    expect(body.disable_notification).toBe(false);
  });
});
