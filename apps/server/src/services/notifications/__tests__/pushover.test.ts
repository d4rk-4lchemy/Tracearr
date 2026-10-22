import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPriority } from '@tracearr/shared';
import type { NotificationEvent } from '../events.js';

const mockBuildMediaLinks = vi.fn();
vi.mock('../mediaLinks.js', () => ({
  buildMediaLinks: (...args: unknown[]) => mockBuildMediaLinks(...args) as unknown,
}));

import {
  pushoverType,
  type PushoverConfig,
  type PushoverMessage,
} from '../destinations/pushover.js';
import { mediaUpgraded, session, severityEvents } from './fixtures.js';
import type { RenderContext } from '../destinations/types.js';

mockBuildMediaLinks.mockResolvedValue([
  { label: 'Tracearr', url: 'https://t.example/media/1' },
  { label: 'Plex', url: 'https://plex.example/item' },
]);

const config: PushoverConfig = { userKey: 'u_user_key_123', apiToken: 'a_api_token_456' };
const destination = { id: 'dest-1', name: 'My Pushover' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const render = async (
  event: Parameters<typeof pushoverType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<PushoverMessage> => pushoverType.render(event, config, ctx);

describe('pushoverType.render', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the priority from the event severity', async () => {
    const messages = await Promise.all(severityEvents.map((event) => render(event)));
    expect(messages.map((m) => m.priority)).toEqual(['1', '-1', '1', '-1']);
  });

  it('sends an own-text event quiet whatever its severity, unless the automation sets a level', async () => {
    const failedSend = {
      type: 'newsletter_send',
      payload: {
        newsletterId: 'n-1',
        sendId: 'send-1',
        name: 'Weekly',
        outcome: 'failed',
        trigger: 'schedule',
        recipientCount: 42,
        itemCounts: { movies: 3, shows: 1, episodes: 4, albums: 0, mostWatched: 0 },
        error: 'smtp down',
        windowStart: '2026-08-26T00:00:00.000Z',
        windowEnd: '2026-09-02T00:00:00.000Z',
        historyUrl: null,
      },
    } as NotificationEvent;
    expect((await render(failedSend)).priority).toBe('-1');
    expect((await render(failedSend, automationCtx('high'))).priority).toBe('1');
  });

  it('links the first media link, and a stream start has none', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const media = await render(mediaUpgraded);
    await pushoverType.deliver(media, config, deliverCtx);
    const sent = new URLSearchParams(f.mock.calls[0]?.[1].body);
    expect(sent.get('url')).toBe('https://t.example/media/1');
    expect(sent.get('url_title')).toBe('Tracearr');

    const stream = await render({ type: 'session_started', payload: session });
    expect(stream.url).toBeUndefined();
    expect(stream.url_title).toBeUndefined();
  });

  it('cuts a long link label to the url title limit', async () => {
    mockBuildMediaLinks.mockResolvedValueOnce([
      { label: 'x'.repeat(150), url: 'https://t.example/media/1' },
    ]);
    const { url_title } = await render(mediaUpgraded);
    expect(Array.from(url_title ?? '')).toHaveLength(100);
    expect(url_title?.endsWith('…')).toBe(true);
  });
});

describe('pushoverType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const message: PushoverMessage = {
    title: 'Server Offline',
    message: 'Plex Server is not responding',
    priority: '1',
  };

  it('posts a form-encoded body to the pushover api', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);

    await pushoverType.deliver(message, config, deliverCtx);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://api.pushover.net/1/messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      token: 'a_api_token_456',
      user: 'u_user_key_123',
      title: 'Server Offline',
      message: 'Plex Server is not responding',
      priority: '1',
    });
  });

  it('throws when pushover rejects the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid token', { status: 400 }))
    );

    await expect(pushoverType.deliver(message, config, deliverCtx)).rejects.toThrow(
      /400 invalid token/
    );
  });

  it('posts the test message', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);

    await pushoverType.test(config, deliverCtx);

    const body = new URLSearchParams(f.mock.calls[0]?.[1].body as string);
    expect(Object.fromEntries(body)).toEqual({
      token: 'a_api_token_456',
      user: 'u_user_key_123',
      title: 'Test Notification',
      message: 'This is a test notification from Tracearr',
      priority: '-1',
    });
  });
});

const automationCtx = (priority?: NotificationPriority): RenderContext => ({
  destination,
  source: {
    kind: 'automation',
    automationId: 'a-1',
    automationName: 'Now playing',
    ...(priority && { priority }),
  },
});

describe('pushoverType.render with an automation source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps every send priority and keeps the event priority without one', async () => {
    const expected = { lowest: '-2', low: '-1', normal: '0', high: '1', urgent: '2' } as const;
    for (const [priority, value] of Object.entries(expected)) {
      const message = await render(
        { type: 'session_started', payload: session },
        automationCtx(priority as keyof typeof expected)
      );
      expect(message.priority).toBe(value);
    }
    const automatic = await render({ type: 'session_started', payload: session }, automationCtx());
    expect(automatic.priority).toBe('-1');
  });

  it('sends retry and expire with an urgent message and not otherwise', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const urgent = await render(
      { type: 'session_started', payload: session },
      automationCtx('urgent')
    );
    await pushoverType.deliver(urgent, config, deliverCtx);
    const sent = new URLSearchParams(f.mock.calls[0]?.[1].body);
    expect(sent.get('priority')).toBe('2');
    expect(sent.get('retry')).toBe('60');
    expect(sent.get('expire')).toBe('3600');

    f.mockClear();
    const high = await render({ type: 'session_started', payload: session }, automationCtx('high'));
    await pushoverType.deliver(high, config, deliverCtx);
    expect(new URLSearchParams(f.mock.calls[0]?.[1].body).has('retry')).toBe(false);
  });
});
