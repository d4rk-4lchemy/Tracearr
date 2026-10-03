import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  WS_EVENTS,
  escapeFor,
  type NotificationToast,
} from '@tracearr/shared';
import { getPubSubService } from '../../cache.js';
import { toNotificationPayload } from '../types.js';
import type { NotificationEvent, NotificationSource } from '../events.js';
import { fitted } from './overrides.js';
import type { DestinationType } from './types.js';

const PROFILE = DESTINATION_TEXT_PROFILES.web_toast;

export interface ToastRendered {
  toast?: NotificationToast;
}

/** The automation is the gate: only its own sends toast, and every event type does. */
function toastFor(event: NotificationEvent, source: NotificationSource): NotificationToast | null {
  if (source.kind !== 'automation') return null;
  const payload = toNotificationPayload(event, source, escapeFor(PROFILE));
  const text = fitted(payload, PROFILE);
  return {
    title: text.title,
    message: text.message,
    automationId: source.automationId,
    automationName: source.automationName,
    severity: payload.severity,
  };
}

export const webToastType: DestinationType<Record<string, never>, ToastRendered> = {
  kind: 'web_toast',
  events: DESTINATION_TYPES.web_toast.events,
  render(event, _config, ctx) {
    // The health banner is published by the producer, so a toast is all this carries.
    const toast = toastFor(event, ctx.source);
    return toast ? { toast } : {};
  },
  async deliver(rendered) {
    if (!rendered.toast) return;
    const pubSub = getPubSubService();
    if (!pubSub) throw new Error('pub/sub unavailable');
    await pubSub.publish(WS_EVENTS.NOTIFICATION_TOAST, rendered.toast);
  },
  test: async () => {
    // no config to test; the route returns 400 for built-ins
  },
};
