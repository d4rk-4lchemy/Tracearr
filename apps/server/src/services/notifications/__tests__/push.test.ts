import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { pushNotificationService } from '../../pushNotification.js';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { pushType, type PushRendered } from '../destinations/push.js';
import type { RenderContext } from '../destinations/types.js';

const destination = { id: 'dest-push', name: 'Mobile push' };
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
  severity: 'warning',
  data: { serverId: 'server-1', thumbPath: '/thumb.jpg', userThumbUrl: '/avatar.jpg' },
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
  event: Parameters<typeof pushType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<PushRendered> => pushType.render(event, {}, ctx);

describe('pushType.render', () => {
  it('renders a rule violation as a direct rule send with the image fields', async () => {
    const rendered = await render({ type: 'violation', payload: violation }, ruleCtx);

    expect(rendered).toEqual({
      kind: 'rule',
      title: 'Rule fired',
      message: 'Too many streams',
      data: {
        ruleId: 'rule-456',
        ruleName: 'Test Rule',
        serverId: 'server-1',
        thumbPath: '/thumb.jpg',
        userThumbUrl: '/avatar.jpg',
      },
    });
  });

  it('does not forward other violation data keys into the push payload', async () => {
    const noisy = {
      ...violation,
      data: { ...violation.data, type: 'violation_detected', evidence: [{ big: true }] },
    };
    const rendered = await render({ type: 'violation', payload: noisy }, ruleCtx);
    expect(rendered.kind).toBe('rule');
    if (rendered.kind === 'rule') {
      expect(rendered.data).not.toHaveProperty('type');
      expect(rendered.data).not.toHaveProperty('evidence');
    }
  });

  it('renders a system violation as the raw event', async () => {
    const event = { type: 'violation', payload: violation } as const;

    expect(await render(event)).toEqual({ kind: 'system', event });
  });

  it('renders a non-violation event from a rule source as the raw event', async () => {
    const event = {
      type: 'server_down',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    } as const;

    expect(await render(event, ruleCtx)).toEqual({ kind: 'system', event });
  });
});

function spyOnNotifiers() {
  return {
    notifyViolation: vi
      .spyOn(pushNotificationService, 'notifyViolation')
      .mockResolvedValue(undefined),
    notifySessionStarted: vi
      .spyOn(pushNotificationService, 'notifySessionStarted')
      .mockResolvedValue(undefined),
    notifySessionStopped: vi
      .spyOn(pushNotificationService, 'notifySessionStopped')
      .mockResolvedValue(undefined),
    notifyServerDown: vi
      .spyOn(pushNotificationService, 'notifyServerDown')
      .mockResolvedValue(undefined),
    notifyServerUp: vi
      .spyOn(pushNotificationService, 'notifyServerUp')
      .mockResolvedValue(undefined),
    notifyRuleDirect: vi
      .spyOn(pushNotificationService, 'notifyRuleDirect')
      .mockResolvedValue(undefined),
  };
}

describe('pushType.deliver', () => {
  let spies: ReturnType<typeof spyOnNotifiers>;

  beforeEach(() => {
    spies = spyOnNotifiers();
  });

  it('sends a rule render through notifyRuleDirect', async () => {
    await pushType.deliver(
      {
        kind: 'rule',
        title: 'Rule fired',
        message: 'Too many streams',
        data: { ruleId: 'rule-456', ruleName: 'Test Rule' },
      },
      {},
      deliverCtx
    );

    expect(spies.notifyRuleDirect).toHaveBeenCalledWith('Rule fired', 'Too many streams', {
      ruleId: 'rule-456',
      ruleName: 'Test Rule',
    });
    expect(spies.notifyViolation).not.toHaveBeenCalled();
  });

  it('sends a system violation through notifyViolation', async () => {
    await pushType.deliver(
      { kind: 'system', event: { type: 'violation', payload: violation } },
      {},
      deliverCtx
    );

    expect(spies.notifyViolation).toHaveBeenCalledWith(violation);
    expect(spies.notifyRuleDirect).not.toHaveBeenCalled();
  });

  it('sends a stream start through notifySessionStarted', async () => {
    await pushType.deliver(
      { kind: 'system', event: { type: 'session_started', payload: session } },
      {},
      deliverCtx
    );

    expect(spies.notifySessionStarted).toHaveBeenCalledWith(session);
  });

  it('sends a stream stop through notifySessionStopped', async () => {
    await pushType.deliver(
      { kind: 'system', event: { type: 'session_stopped', payload: session } },
      {},
      deliverCtx
    );

    expect(spies.notifySessionStopped).toHaveBeenCalledWith(session);
  });

  it('sends server down with the name and id', async () => {
    await pushType.deliver(
      {
        kind: 'system',
        event: { type: 'server_down', payload: { serverName: 'Plex Server', serverId: 's1' } },
      },
      {},
      deliverCtx
    );

    expect(spies.notifyServerDown).toHaveBeenCalledWith('Plex Server', 's1');
  });

  it('sends server up with the name and id', async () => {
    await pushType.deliver(
      {
        kind: 'system',
        event: { type: 'server_up', payload: { serverName: 'Plex Server', serverId: 's1' } },
      },
      {},
      deliverCtx
    );

    expect(spies.notifyServerUp).toHaveBeenCalledWith('Plex Server', 's1');
  });

  it('sends nothing for a plugin update', async () => {
    await pushType.deliver(
      {
        kind: 'system',
        event: {
          type: 'plugin_update_available',
          payload: {
            serverId: 'server-1',
            serverName: 'Jellyfin',
            serverType: 'jellyfin',
            installedVersion: '0.2.0',
            latestVersion: '0.3.0',
            downloadUrl: 'https://example.com/plugin.zip',
          },
        },
      },
      {},
      deliverCtx
    );

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
