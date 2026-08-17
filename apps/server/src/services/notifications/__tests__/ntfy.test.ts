import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { ntfyType, type NtfyConfig, type NtfyMessage } from '../destinations/ntfy.js';
import type { RenderContext } from '../destinations/types.js';

const config: NtfyConfig = {
  url: 'https://ntfy.example.com',
  topic: 'tracearr-alerts',
  authToken: 'tk_secret_token_123',
};
const noAuthConfig: NtfyConfig = { url: 'https://ntfy.example.com', topic: 'tracearr-alerts' };
const destination = { id: 'dest-1', name: 'My Ntfy' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const violation: ViolationWithDetails = {
  id: 'violation-123',
  ruleId: 'rule-456',
  serverUserId: 'user-789',
  sessionId: 'session-123',
  severity: 'warning',
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
  event: Parameters<typeof ntfyType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<NtfyMessage> => ntfyType.render(event, config, ctx);

describe('ntfyType.render', () => {
  it('builds the violation message with the severity priority', async () => {
    const message = await render({ type: 'violation', payload: violation });

    expect(message).toEqual({
      topic: 'tracearr-alerts',
      title: 'Violation Detected',
      message: 'User Test User triggered Test Rule (Warning severity)',
      priority: 4,
      tags: ['tracearr'],
    });
  });

  it('builds the stream started message', async () => {
    const message = await render({ type: 'session_started', payload: session });

    expect(message).toEqual({
      topic: 'tracearr-alerts',
      title: 'Stream Started',
      message: 'testuser started watching Test Movie - 2024',
      priority: 3,
      tags: ['tracearr'],
    });
  });

  it('builds the stream stopped message with a formatted duration', async () => {
    const message = await render({ type: 'session_stopped', payload: session });

    expect(message.title).toBe('Stream Ended');
    expect(message.message).toBe('testuser finished watching Test Movie - 2024 (1h 2m)');
    expect(message.priority).toBe(3);
  });

  it('builds the server down message at priority 5', async () => {
    const message = await render({
      type: 'server_down',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      topic: 'tracearr-alerts',
      title: 'Server Offline',
      message: 'Plex Server is not responding',
      priority: 5,
      tags: ['tracearr'],
    });
  });

  it('builds the server up message at priority 4', async () => {
    const message = await render({
      type: 'server_up',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      topic: 'tracearr-alerts',
      title: 'Server Online',
      message: 'Plex Server is back online',
      priority: 4,
      tags: ['tracearr'],
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
    expect(message.message).toBe('User Test User triggered Test Rule (Warning severity)');
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
