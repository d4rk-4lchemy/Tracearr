import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPriority } from '@tracearr/shared';

const mockBuildMediaLinks = vi.fn();
vi.mock('../mediaLinks.js', () => ({
  buildMediaLinks: (...args: unknown[]) => mockBuildMediaLinks(...args) as unknown,
}));

import { gotifyType, type GotifyMessage } from '../destinations/gotify.js';
import { mediaUpgraded, session, severityEvents } from './fixtures.js';
import type { RenderContext } from '../destinations/types.js';

mockBuildMediaLinks.mockResolvedValue([
  { label: 'Tracearr', url: 'https://t.example/media/1' },
  { label: 'Plex', url: 'https://plex.example/item' },
]);

const config = { url: 'https://gotify.example.com/message?token=abc' };
const destination = { id: 'dest-1', name: 'My Gotify' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const render = async (
  event: Parameters<typeof gotifyType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<GotifyMessage> => gotifyType.render(event, config, ctx);

describe('gotifyType.render', () => {
  it('sets the priority from the event severity', async () => {
    const messages = await Promise.all(severityEvents.map((event) => render(event)));
    expect(messages.map((m) => m.priority)).toEqual([8, 2, 8, 2]);
  });

  it('opens the first media link on click, and a stream start has none', async () => {
    const media = await render(mediaUpgraded);
    expect(media.extras).toEqual({
      'client::notification': { click: { url: 'https://t.example/media/1' } },
    });

    const stream = await render({ type: 'session_started', payload: session });
    expect(stream.extras).toBeUndefined();
  });
});

describe('gotifyType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const message: GotifyMessage = {
    title: 'Server Offline',
    message: 'Plex Server is not responding',
    priority: 5,
  };

  it('posts the message as json', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await gotifyType.deliver(message, config, deliverCtx);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(config.url);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(message);
  });

  it('throws when Gotify rejects the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    );

    await expect(gotifyType.deliver(message, config, deliverCtx)).rejects.toThrow(
      /401 Unauthorized/
    );
  });

  it('posts the test message', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await gotifyType.test(config, deliverCtx);

    expect(JSON.parse(f.mock.calls[0]?.[1].body)).toEqual({
      title: 'Test Notification',
      message: 'This is a test notification from Tracearr',
      priority: 5,
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

describe('gotifyType.render with an automation source', () => {
  it('maps every send priority and keeps the event priority without one', async () => {
    const expected = { lowest: 0, low: 2, normal: 5, high: 8, urgent: 10 } as const;
    for (const [priority, value] of Object.entries(expected)) {
      const message = await render(
        { type: 'session_started', payload: session },
        automationCtx(priority as keyof typeof expected)
      );
      expect(message.priority).toBe(value);
    }
    const automatic = await render({ type: 'session_started', payload: session }, automationCtx());
    expect(automatic.priority).toBe(2);
  });
});
