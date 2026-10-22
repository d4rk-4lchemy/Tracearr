import type {
  EngineAutomation,
  PushDeliveryStatus,
  PushEventPreference,
  TriggerType,
} from '@tracearr/shared';
import { getActiveAutomations } from '../jobs/poller/database.js';
import { leaves } from './notifications/destinationRefs.js';
import { listDestinations } from './notifications/destinationStore.js';

/**
 * The device toggle that filters what each trigger sends to push; null where only the
 * master toggle applies. Follows nativeEventFor in the executors: a trigger with no
 * event of its own sends the violation shape.
 */
const TRIGGER_PREFERENCE = {
  'session.started': 'onStreamStarted',
  'session.first_seen': 'onStreamStarted',
  'session.stopped': 'onStreamStopped',
  'session.transcode_changed': 'onViolationDetected',
  'session.paused': 'onViolationDetected',
  'session.held_for': 'onViolationDetected',
  'account.inactive_for': 'onViolationDetected',
  'account.new_device': 'onNewDevice',
  'account.trust_changed': 'onTrustScoreChanged',
  'account.media_downloaded': 'onViolationDetected',
  'media.added': null,
  'media.upgraded': null,
  'server.down': 'onServerDown',
  'server.up': 'onServerUp',
  'plugin.update_available': null,
  'server.update_available': null,
  'tracearr.update_available': null,
  'newsletter.sent': null,
  'newsletter.failed': null,
} as const satisfies Record<TriggerType, PushEventPreference | null>;

const sendsTo = (automation: Pick<EngineAutomation, 'actions'>, destinationId: string): boolean =>
  automation.actions.actions
    .filter((action) => action.enabled !== false)
    .flatMap(leaves)
    .some(
      (action) =>
        action.type === 'send' && action.enabled !== false && action.to.includes(destinationId)
    );

/** How many of the automations send each event to the destination, one count per automation. */
export function pushSenderCounts(
  automations: readonly Pick<EngineAutomation, 'kind' | 'triggers' | 'actions'>[],
  destinationId: string
): Record<PushEventPreference, number> {
  const counts: Record<PushEventPreference, number> = {
    onViolationDetected: 0,
    onStreamStarted: 0,
    onStreamStopped: 0,
    onNewDevice: 0,
    onTrustScoreChanged: 0,
    onServerDown: 0,
    onServerUp: 0,
  };
  for (const automation of automations) {
    const triggers = automation.triggers.filter((trigger) => trigger.enabled);
    if (triggers.length === 0 || !sendsTo(automation, destinationId)) continue;
    // Only a notification automation sends its trigger's own event.
    const preferences =
      automation.kind === 'notification'
        ? triggers.map((trigger) => TRIGGER_PREFERENCE[trigger.type])
        : (['onViolationDetected'] as const);
    for (const preference of new Set(preferences)) {
      if (preference) counts[preference] += 1;
    }
  }
  return counts;
}

export async function getPushDelivery(): Promise<Omit<PushDeliveryStatus, 'tokenRegistered'>> {
  const push = (await listDestinations()).find((d) => d.type === 'push');
  if (!push) {
    return {
      destinationEnabled: false,
      violationsSubscribed: false,
      automations: pushSenderCounts([], ''),
    };
  }
  return {
    destinationEnabled: push.enabled,
    violationsSubscribed: push.events.includes('violation_detected'),
    automations: pushSenderCounts(await getActiveAutomations(), push.id),
  };
}
