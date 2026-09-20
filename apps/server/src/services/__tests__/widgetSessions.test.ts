/**
 * Which session updates wake the home screen widget: only changes to a field
 * it renders, for a session the server saw start.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createMockActiveSession } from '../../test/fixtures.js';
import { WidgetSessionTracker } from '../widgetSessions.js';

const playing = createMockActiveSession({
  id: 'session-1',
  state: 'playing',
  isTranscode: false,
  quality: '1080p',
  bitrate: 8000,
  progressMs: 60_000,
});

describe('WidgetSessionTracker', () => {
  let tracker: WidgetSessionTracker;

  beforeEach(() => {
    tracker = new WidgetSessionTracker();
    tracker.started(playing);
  });

  it('wakes when the session pauses', () => {
    expect(tracker.updated({ ...playing, state: 'paused' })).toBe(true);
  });

  it('wakes when the session switches to a transcode', () => {
    expect(tracker.updated({ ...playing, isTranscode: true })).toBe(true);
  });

  it('wakes when quality or bitrate changes', () => {
    expect(tracker.updated({ ...playing, quality: '720p' })).toBe(true);
    expect(tracker.updated({ ...playing, quality: '720p', bitrate: 4000 })).toBe(true);
  });

  it('stays asleep for a progress-only update', () => {
    expect(tracker.updated({ ...playing, progressMs: 120_000 })).toBe(false);
  });

  it('records a session it never saw start without waking, then tracks it', () => {
    const unseen = { ...playing, id: 'session-2' };

    expect(tracker.updated({ ...unseen, state: 'paused' })).toBe(false);
    expect(tracker.updated(unseen)).toBe(true);
  });

  it('forgets a stopped session', () => {
    tracker.stopped('session-1');

    expect(tracker.updated({ ...playing, state: 'paused' })).toBe(false);
  });
});
