import { DESTINATION_TYPES, WS_EVENTS, type NotificationToast } from '@tracearr/shared';
import { getPubSubService } from '../../cache.js';
import type { DestinationType } from './types.js';

export type ToastRendered =
  | {
      kind: 'server';
      event: typeof WS_EVENTS.SERVER_DOWN | typeof WS_EVENTS.SERVER_UP;
      data: { serverId: string; serverName: string };
    }
  | { kind: 'rule'; data: NotificationToast }
  | { kind: 'none' };

export const webToastType: DestinationType<Record<string, never>, ToastRendered> = {
  kind: 'web_toast',
  events: DESTINATION_TYPES.web_toast.events,
  render(event, _config, ctx) {
    if (ctx.source.kind === 'rule' && event.type === 'violation') {
      const v = event.payload;
      return {
        kind: 'rule',
        data: {
          title: ctx.source.title,
          message: ctx.source.message,
          ruleId: v.rule.id,
          ruleName: v.rule.name,
          severity: v.severity,
        },
      };
    }
    if (event.type === 'server_down') {
      return { kind: 'server', event: WS_EVENTS.SERVER_DOWN, data: event.payload };
    }
    if (event.type === 'server_up') {
      return { kind: 'server', event: WS_EVENTS.SERVER_UP, data: event.payload };
    }
    // stream/violation events already reach the browser as data events over pub/sub; the client gates the toast on this row's events
    return { kind: 'none' };
  },
  async deliver(rendered) {
    if (rendered.kind === 'none') return;
    const pubSub = getPubSubService();
    if (!pubSub) throw new Error('pub/sub unavailable');
    if (rendered.kind === 'server') await pubSub.publish(rendered.event, rendered.data);
    else await pubSub.publish(WS_EVENTS.NOTIFICATION_TOAST, rendered.data);
  },
  test: async () => {
    // no config to test; the route returns 400 for built-ins
  },
};
