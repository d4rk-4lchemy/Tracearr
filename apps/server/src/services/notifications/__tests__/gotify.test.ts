import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { gotifyType, type GotifyMessage } from '../destinations/gotify.js';
import type { RenderContext } from '../destinations/types.js';

const config = { url: 'https://gotify.example.com/message?token=abc' };
const destination = { id: 'dest-1', name: 'My Gotify' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const violation: ViolationWithDetails = {
  id: 'violation-123',
  ruleId: 'rule-456',
  serverUserId: 'user-789',
  sessionId: 'session-123',
  severity: 'high',
  data: { reason: 'test violation' },
  acknowledgedAt: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  user: {
    id: 'user-789',
    username: 'testuser',
    serverId: 'server-id',
    thumbUrl: null,
    identityName: 'Test User',
  },
  rule: { id: 'rule-456', name: 'Test Rule', type: 'concurrent_streams' },
};

const session = createMockActiveSession({ durationMs: 3_725_000 });

const render = async (
  event: Parameters<typeof gotifyType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<GotifyMessage> => gotifyType.render(event, config, ctx);

describe('gotifyType.render', () => {
  it('builds the violation message at the severity priority', async () => {
    const message = await render({ type: 'violation', payload: violation });

    expect(message).toEqual({
      title: 'Violation Detected',
      message: 'User Test User triggered Test Rule (High severity)',
      priority: 5,
    });
  });

  it('builds the stream started message', async () => {
    const message = await render({ type: 'session_started', payload: session });

    expect(message).toEqual({
      title: 'Stream Started',
      message: 'testuser started watching Test Movie - 2024',
      priority: 3,
    });
  });

  it('builds the stream stopped message with a formatted duration', async () => {
    const message = await render({ type: 'session_stopped', payload: session });

    expect(message).toEqual({
      title: 'Stream Ended',
      message: 'testuser finished watching Test Movie - 2024 (1h 2m)',
      priority: 3,
    });
  });

  it('builds the server down message at priority 5', async () => {
    const message = await render({
      type: 'server_down',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      title: 'Server Offline',
      message: 'Plex Server is not responding',
      priority: 5,
    });
  });

  it('builds the server up message at priority 4', async () => {
    const message = await render({
      type: 'server_up',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      title: 'Server Online',
      message: 'Plex Server is back online',
      priority: 4,
    });
  });

  it('builds the plugin update message', async () => {
    const message = await render({
      type: 'plugin_update_available',
      payload: {
        serverId: 'server-1',
        serverName: 'Jellyfin',
        serverType: 'jellyfin',
        installedVersion: '0.2.0',
        latestVersion: '0.3.0',
        downloadUrl: 'https://example.com/plugin.zip',
      },
    });

    expect(message.title).toBe('Plugin Update Available');
    expect(message.message).toContain('Jellyfin: ');
    expect(message.message).toContain('latest 0.3.0');
    expect(message.priority).toBe(3);
  });

  it('uses the rule source title for a rule send', async () => {
    const message = await render(
      { type: 'violation', payload: violation },
      { destination, source: { kind: 'rule', title: 'Rule fired', message: 'Too many streams' } }
    );

    expect(message.title).toBe('Rule fired');
    expect(message.message).toBe('User Test User triggered Test Rule (High severity)');
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
      priority: 3,
    });
  });
});
