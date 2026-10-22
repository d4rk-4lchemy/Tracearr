import { afterEach, describe, expect, it, vi } from 'vitest';

const mockBuildMediaLinks = vi.fn();
vi.mock('../mediaLinks.js', () => ({
  buildMediaLinks: (...args: unknown[]) => mockBuildMediaLinks(...args) as unknown,
}));

import { appriseType, type AppriseMessage } from '../destinations/apprise.js';
import { mediaUpgraded, severityEvents } from './fixtures.js';
import type { RenderContext } from '../destinations/types.js';

mockBuildMediaLinks.mockResolvedValue([
  { label: 'Tracearr', url: 'https://t.example/media/1' },
  { label: 'Plex', url: 'https://plex.example/item' },
]);

const config = { url: 'https://apprise.example.com/notify' };
const destination = { id: 'dest-1', name: 'My Apprise' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const render = async (
  event: Parameters<typeof appriseType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<AppriseMessage> => appriseType.render(event, config, ctx);

describe('appriseType.render', () => {
  it('sets the type from the event severity', async () => {
    const messages = await Promise.all(severityEvents.map((event) => render(event)));
    expect(messages.map((m) => m.type)).toEqual(['failure', 'info', 'failure', 'info']);
  });

  it('carries no link on a media event', async () => {
    const message = await render(mediaUpgraded);
    expect(Object.keys(message).sort()).toEqual(['body', 'format', 'title', 'type']);
    expect(message.format).toBe('text');
  });

  it('never looks up media links', async () => {
    mockBuildMediaLinks.mockClear();
    await render(mediaUpgraded);
    expect(mockBuildMediaLinks).not.toHaveBeenCalled();
  });
});

describe('appriseType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const message: AppriseMessage = {
    title: 'Server Offline',
    body: 'Plex Server is not responding',
    type: 'failure',
    format: 'text',
  };

  it('posts the message as json', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await appriseType.deliver(message, config, deliverCtx);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(config.url);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(message);
  });

  it('throws when Apprise rejects the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad url', { status: 400 })));

    await expect(appriseType.deliver(message, config, deliverCtx)).rejects.toThrow(/400 bad url/);
  });

  it('posts the test message', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await appriseType.test(config, deliverCtx);

    expect(JSON.parse(f.mock.calls[0]?.[1].body)).toEqual({
      title: 'Test Notification',
      body: 'This is a test notification from Tracearr',
      type: 'info',
      format: 'text',
    });
  });
});
