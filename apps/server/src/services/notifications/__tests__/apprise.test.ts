import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { appriseType, type AppriseMessage } from '../destinations/apprise.js';
import type { RenderContext } from '../destinations/types.js';

const config = { url: 'https://apprise.example.com/notify' };
const destination = { id: 'dest-1', name: 'My Apprise' };
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
  event: Parameters<typeof appriseType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<AppriseMessage> => appriseType.render(event, config, ctx);

describe('appriseType.render', () => {
  it('builds the violation message with the severity type', async () => {
    const message = await render({ type: 'violation', payload: violation });

    expect(message).toEqual({
      title: 'Violation Detected',
      body: 'User Test User triggered Test Rule (Warning severity)',
      type: 'warning',
    });
  });

  it('maps a high severity violation to the failure type', async () => {
    const message = await render({
      type: 'violation',
      payload: { ...violation, severity: 'high' },
    });

    expect(message.type).toBe('failure');
  });

  it('builds the stream started message', async () => {
    const message = await render({ type: 'session_started', payload: session });

    expect(message).toEqual({
      title: 'Stream Started',
      body: 'testuser started watching Test Movie - 2024',
      type: 'info',
    });
  });

  it('builds the stream stopped message with a formatted duration', async () => {
    const message = await render({ type: 'session_stopped', payload: session });

    expect(message).toEqual({
      title: 'Stream Ended',
      body: 'testuser finished watching Test Movie - 2024 (1h 2m)',
      type: 'info',
    });
  });

  it('builds the server down message as a failure', async () => {
    const message = await render({
      type: 'server_down',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      title: 'Server Offline',
      body: 'Plex Server is not responding',
      type: 'failure',
    });
  });

  it('builds the server up message as a success', async () => {
    const message = await render({
      type: 'server_up',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(message).toEqual({
      title: 'Server Online',
      body: 'Plex Server is back online',
      type: 'success',
    });
  });

  it('builds the plugin update message as a warning', async () => {
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
    expect(message.body).toContain('Jellyfin: ');
    expect(message.body).toContain('latest 0.3.0');
    expect(message.type).toBe('warning');
  });

  it('uses the rule source title for a rule send', async () => {
    const message = await render(
      { type: 'violation', payload: violation },
      { destination, source: { kind: 'rule', title: 'Rule fired', message: 'Too many streams' } }
    );

    expect(message.title).toBe('Rule fired');
    expect(message.body).toBe('User Test User triggered Test Rule (Warning severity)');
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
    });
  });
});
