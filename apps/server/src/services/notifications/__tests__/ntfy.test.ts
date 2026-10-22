import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPriority } from '@tracearr/shared';

const mockBuildMediaLinks = vi.fn();
vi.mock('../mediaLinks.js', () => ({
  buildMediaLinks: (...args: unknown[]) => mockBuildMediaLinks(...args) as unknown,
}));

import { ntfyType, type NtfyConfig, type NtfyMessage } from '../destinations/ntfy.js';
import { mediaUpgraded, session, severityEvents, violation } from './fixtures.js';
import type { RenderContext } from '../destinations/types.js';

mockBuildMediaLinks.mockResolvedValue([
  { label: 'Tracearr', url: 'https://t.example/media/1' },
  { label: 'Plex', url: 'https://plex.example/item' },
]);

const config: NtfyConfig = {
  url: 'https://ntfy.example.com',
  topic: 'tracearr-alerts',
  authToken: 'tk_secret_token_123',
};
const noAuthConfig: NtfyConfig = { url: 'https://ntfy.example.com', topic: 'tracearr-alerts' };
const destination = { id: 'dest-1', name: 'My Ntfy' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const render = async (
  event: Parameters<typeof ntfyType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<NtfyMessage> => ntfyType.render(event, config, ctx);

describe('ntfyType.render', () => {
  it('sets the priority from the event severity', async () => {
    const messages = await Promise.all(severityEvents.map((event) => render(event)));
    expect(messages.map((m) => m.priority)).toEqual([4, 2, 4, 2]);
  });

  it('opens the first media link on click, and a stream start has none', async () => {
    expect((await render(mediaUpgraded)).click).toBe('https://t.example/media/1');
    expect((await render({ type: 'session_started', payload: session })).click).toBeUndefined();
  });

  it('falls back to the tracearr topic when the config topic is empty', async () => {
    const message = await ntfyType.render(
      { type: 'violation', payload: violation },
      {
        ...config,
        topic: '',
      },
      systemCtx
    );

    expect(message.topic).toBe('tracearr');
  });
});

describe('ntfyType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const message: NtfyMessage = {
    topic: 'tracearr-alerts',
    title: 'Server Offline',
    message: 'Plex Server is not responding',
    priority: 5,
    tags: ['tracearr'],
  };

  it('posts the message with a bearer token when one is configured', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await ntfyType.deliver(message, config, deliverCtx);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://ntfy.example.com/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tk_secret_token_123',
    });
    expect(JSON.parse(init.body)).toEqual(message);
  });

  it('omits the Authorization header without a token', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await ntfyType.deliver(message, noAuthConfig, deliverCtx);

    expect(f.mock.calls[0]?.[1].headers).not.toHaveProperty('Authorization');
  });

  it('throws when ntfy rejects the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    );

    await expect(ntfyType.deliver(message, config, deliverCtx)).rejects.toThrow(/401 Unauthorized/);
  });

  it('posts the test message', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await ntfyType.test(config, deliverCtx);

    expect(JSON.parse(f.mock.calls[0]?.[1].body)).toEqual({
      topic: 'tracearr-alerts',
      title: 'Test Notification',
      message: 'This is a test notification from Tracearr',
      priority: 3,
      tags: ['tracearr'],
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

describe('ntfyType.render with an automation source', () => {
  it('maps every send priority and keeps the event priority without one', async () => {
    const expected = { lowest: 1, low: 2, normal: 3, high: 4, urgent: 5 } as const;
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
