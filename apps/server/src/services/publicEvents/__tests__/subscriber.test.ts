import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDIS_KEYS } from '@tracearr/shared';
import { startSubscriber, stopSubscriber, subscriberRunning } from '../subscriber.js';
import type { Redis } from 'ioredis';

function fakeRedis() {
  const dup = Object.assign(new EventEmitter(), {
    subscribe: vi.fn(async () => 1),
    disconnect: vi.fn(),
  });
  const base = { duplicate: vi.fn(() => dup) } as unknown as Redis;
  return { base, dup };
}

describe('public events subscriber', () => {
  afterEach(() => {
    stopSubscriber();
  });

  it('subscribes once, resolves when the subscribe is acknowledged, parses messages, and reports a resubscribe only after the first ready', async () => {
    const { base, dup } = fakeRedis();
    let acknowledge: () => void = () => undefined;
    dup.subscribe.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          acknowledge = () => resolve(1);
        })
    );
    const onMessage = vi.fn();
    const onResubscribe = vi.fn();
    const first = startSubscriber(base, { onMessage, onResubscribe, onError: vi.fn() });
    const second = startSubscriber(base, { onMessage, onResubscribe, onError: vi.fn() });

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(dup.subscribe).toHaveBeenCalledWith(REDIS_KEYS.PUBLIC_EVENTS_CHANNEL);
    expect(subscriberRunning()).toBe(true);
    expect(second).toBe(first);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    acknowledge();
    expect(await first).toBe(true);
    expect(settled).toBe(true);

    dup.emit('ready');
    expect(onResubscribe).not.toHaveBeenCalled();
    dup.emit('ready');
    expect(onResubscribe).toHaveBeenCalledTimes(1);

    dup.emit(
      'message',
      REDIS_KEYS.PUBLIC_EVENTS_CHANNEL,
      '{"event":"e","data":1,"at":"2026-10-06T10:00:00.000Z"}'
    );
    dup.emit('message', REDIS_KEYS.PUBLIC_EVENTS_CHANNEL, 'not json');
    dup.emit('message', 'some:other:channel', '{"event":"e","data":1,"at":"x"}');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      event: 'e',
      data: 1,
      at: '2026-10-06T10:00:00.000Z',
    });
  });

  it('a failed subscribe reports the error, stops the subscriber and resolves false', async () => {
    const { base, dup } = fakeRedis();
    dup.subscribe.mockRejectedValueOnce(new Error('no redis'));
    const onError = vi.fn();
    const handlers = { onMessage: vi.fn(), onResubscribe: vi.fn(), onError };
    expect(await startSubscriber(base, handlers)).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(dup.disconnect).toHaveBeenCalledTimes(1);
    expect(subscriberRunning()).toBe(false);

    expect(await startSubscriber(base, handlers)).toBe(true);
    expect(base.duplicate).toHaveBeenCalledTimes(2);
  });

  it('disconnects on stop and ignores events after it', () => {
    const { base, dup } = fakeRedis();
    const onMessage = vi.fn();
    void startSubscriber(base, { onMessage, onResubscribe: vi.fn(), onError: vi.fn() });
    stopSubscriber();
    expect(dup.disconnect).toHaveBeenCalledTimes(1);
    expect(subscriberRunning()).toBe(false);
    dup.emit('message', REDIS_KEYS.PUBLIC_EVENTS_CHANNEL, '{"event":"e","data":1,"at":"x"}');
    expect(onMessage).not.toHaveBeenCalled();
  });
});
