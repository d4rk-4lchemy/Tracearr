import type { ActiveSession, NotificationEventType, ViolationWithDetails } from '@tracearr/shared';

export type NotificationEvent =
  | { type: 'violation'; payload: ViolationWithDetails }
  | { type: 'session_started'; payload: ActiveSession }
  | { type: 'session_stopped'; payload: ActiveSession }
  | { type: 'server_down'; payload: { serverName: string; serverId: string } }
  | { type: 'server_up'; payload: { serverName: string; serverId: string } }
  | {
      type: 'plugin_update_available';
      payload: {
        serverId: string;
        serverName: string;
        serverType: string;
        installedVersion: string | null;
        latestVersion: string;
        downloadUrl: string;
      };
    };

/** Producers keep their discriminators; rows and the UI use NotificationEventType names. */
export const JOB_TYPE_TO_EVENT_TYPE: Record<NotificationEvent['type'], NotificationEventType> = {
  violation: 'violation_detected',
  session_started: 'stream_started',
  session_stopped: 'stream_stopped',
  server_down: 'server_down',
  server_up: 'server_up',
  plugin_update_available: 'plugin_update_available',
};

export function eventTypeOf(event: NotificationEvent): NotificationEventType {
  return JOB_TYPE_TO_EVENT_TYPE[event.type];
}

/** A rule send carries its own title/message; system events are formatted per type from the payload. */
export type NotificationSource =
  { kind: 'system' } | { kind: 'rule'; title: string; message: string };
