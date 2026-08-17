import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { getPubSubService, type PubSubService } from '../../cache.js';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { webToastType, type ToastRendered } from '../destinations/webToast.js';
import type { RenderContext } from '../destinations/types.js';

vi.mock('../../cache.js', () => ({ getPubSubService: vi.fn() }));

const destination = { id: 'dest-toast', name: 'Browser toast' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const ruleCtx: RenderContext = {
  destination,
  source: { kind: 'rule', title: 'Rule fired', message: 'Too many streams' },
};
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

const session = createMockActiveSession();

const render = async (
  event: Parameters<typeof webToastType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<ToastRendered> => webToastType.render(event, {}, ctx);

describe('webToastType.render', () => {
  it('renders server down as a server:down publish', async () => {
    expect(
      await render({ type: 'server_down', payload: { serverName: 'Plex Server', serverId: 's1' } })
    ).toEqual({
      kind: 'server',
      event: 'server:down',
      data: { serverName: 'Plex Server', serverId: 's1' },
    });
  });

  it('renders server up as a server:up publish', async () => {
    expect(
      await render({ type: 'server_up', payload: { serverName: 'Plex Server', serverId: 's1' } })
    ).toEqual({
      kind: 'server',
      event: 'server:up',
      data: { serverName: 'Plex Server', serverId: 's1' },
    });
  });

  it('renders nothing for stream events', async () => {
    expect(await render({ type: 'session_started', payload: session })).toEqual({ kind: 'none' });
    expect(await render({ type: 'session_stopped', payload: session })).toEqual({ kind: 'none' });
  });

  it('renders nothing for a system violation', async () => {
    expect(await render({ type: 'violation', payload: violation })).toEqual({ kind: 'none' });
  });

  it('renders nothing for a plugin update', async () => {
    const rendered = await render({
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

    expect(rendered).toEqual({ kind: 'none' });
  });

  it('renders a rule violation as a toast', async () => {
    expect(await render({ type: 'violation', payload: violation }, ruleCtx)).toEqual({
      kind: 'rule',
      data: {
        title: 'Rule fired',
        message: 'Too many streams',
        ruleId: 'rule-456',
        ruleName: 'Test Rule',
        severity: 'high',
      },
    });
  });
});

describe('webToastType.deliver', () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const mockGetPubSubService = vi.mocked(getPubSubService);

  beforeEach(() => {
    publish.mockClear();
    mockGetPubSubService.mockReturnValue({ publish } as unknown as PubSubService);
  });

  it('publishes server:down with the payload', async () => {
    await webToastType.deliver(
      { kind: 'server', event: 'server:down', data: { serverName: 'Plex', serverId: 's1' } },
      {},
      deliverCtx
    );

    expect(publish).toHaveBeenCalledWith('server:down', { serverName: 'Plex', serverId: 's1' });
  });

  it('publishes server:up with the payload', async () => {
    await webToastType.deliver(
      { kind: 'server', event: 'server:up', data: { serverName: 'Plex', serverId: 's1' } },
      {},
      deliverCtx
    );

    expect(publish).toHaveBeenCalledWith('server:up', { serverName: 'Plex', serverId: 's1' });
  });

  it('publishes the rule toast on notification:toast', async () => {
    const data = {
      title: 'Rule fired',
      message: 'Too many streams',
      ruleId: 'rule-456',
      ruleName: 'Test Rule',
      severity: 'high',
    } as const;

    await webToastType.deliver({ kind: 'rule', data }, {}, deliverCtx);

    expect(publish).toHaveBeenCalledWith('notification:toast', data);
  });

  it('publishes nothing for a none render', async () => {
    await webToastType.deliver({ kind: 'none' }, {}, deliverCtx);

    expect(publish).not.toHaveBeenCalled();
    expect(mockGetPubSubService).not.toHaveBeenCalled();
  });

  it('throws when pub/sub is unavailable', async () => {
    mockGetPubSubService.mockReturnValue(null);

    await expect(
      webToastType.deliver(
        { kind: 'server', event: 'server:down', data: { serverName: 'Plex', serverId: 's1' } },
        {},
        deliverCtx
      )
    ).rejects.toThrow('pub/sub unavailable');
  });
});
