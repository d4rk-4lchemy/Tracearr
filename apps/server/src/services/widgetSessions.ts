/**
 * Tracks the session fields the mobile home screen widget renders, so a
 * session update wakes the widget only when something it shows has changed.
 */

import type { ActiveSession } from '@tracearr/shared';

type WidgetFields = Pick<ActiveSession, 'state' | 'isTranscode' | 'quality' | 'bitrate'>;

function widgetFieldsChanged(previous: WidgetFields, next: WidgetFields): boolean {
  return (
    previous.state !== next.state ||
    previous.isTranscode !== next.isTranscode ||
    previous.quality !== next.quality ||
    previous.bitrate !== next.bitrate
  );
}

export class WidgetSessionTracker {
  private seen = new Map<string, WidgetFields>();

  started(session: ActiveSession): void {
    this.seen.set(session.id, pickWidgetFields(session));
  }

  /** True when the widget should be woken. A session never seen starting is recorded silently. */
  updated(session: ActiveSession): boolean {
    const previous = this.seen.get(session.id);
    this.seen.set(session.id, pickWidgetFields(session));
    return previous !== undefined && widgetFieldsChanged(previous, session);
  }

  stopped(sessionId: string): void {
    this.seen.delete(sessionId);
  }
}

function pickWidgetFields(session: ActiveSession): WidgetFields {
  const { state, isTranscode, quality, bitrate } = session;
  return { state, isTranscode, quality, bitrate };
}
