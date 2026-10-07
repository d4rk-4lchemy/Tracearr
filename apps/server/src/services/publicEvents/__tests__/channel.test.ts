import { describe, expect, it, vi } from 'vitest';
import { REDIS_KEYS, WS_EVENTS } from '@tracearr/shared';
import { PUBLIC_CHANNEL_EVENTS, parseChannelMessage, publishPublicEvent } from '../channel.js';
import type { Redis } from 'ioredis';

describe('public events channel', () => {
  it('allowlists exactly the events the public connection exposes', () => {
    expect([...PUBLIC_CHANNEL_EVENTS].sort()).toEqual(
      [
        WS_EVENTS.SESSION_STARTED,
        WS_EVENTS.SESSION_UPDATED,
        WS_EVENTS.SESSION_STOPPED,
        WS_EVENTS.SESSIONS_PROGRESS,
        WS_EVENTS.VIOLATION_NEW,
        WS_EVENTS.SERVER_DOWN,
        WS_EVENTS.SERVER_UP,
        WS_EVENTS.PUBLIC_API_KEY_CHANGED,
      ].sort()
    );
  });

  it('publishes the event, payload and time on the public channel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));
    const publisher = { publish: vi.fn(async () => 1) } as unknown as Redis & {
      publish: ReturnType<typeof vi.fn>;
    };
    await publishPublicEvent(publisher, 'session:stopped', 'abc');
    expect(publisher.publish).toHaveBeenCalledWith(
      REDIS_KEYS.PUBLIC_EVENTS_CHANNEL,
      '{"event":"session:stopped","data":"abc","at":"2026-10-06T10:00:00.000Z"}'
    );
    vi.useRealTimers();
  });

  it('parses a message and drops anything malformed', () => {
    expect(parseChannelMessage('{"event":"e","data":1,"at":"2026-10-06T10:00:00.000Z"}')).toEqual({
      event: 'e',
      data: 1,
      at: '2026-10-06T10:00:00.000Z',
    });
    expect(parseChannelMessage('{')).toBeNull();
    expect(parseChannelMessage('{"data":1}')).toBeNull();
    expect(parseChannelMessage('{"event":"e","at":"x"}')).toBeNull();
  });
});
