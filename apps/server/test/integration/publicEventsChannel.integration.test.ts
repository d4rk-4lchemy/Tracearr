import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { REDIS_KEYS } from '@tracearr/shared';
import {
  parseChannelMessage,
  publishPublicEvent,
} from '../../src/services/publicEvents/channel.js';

const url = process.env.REDIS_URL ?? 'redis://localhost:6380';
const publisher = new Redis(url);
const subscriber = new Redis(url);

describe('public events channel on Redis', () => {
  afterAll(async () => {
    await publisher.quit();
    await subscriber.quit();
  });

  it('delivers a published event to a subscriber on another connection', async () => {
    await subscriber.subscribe(REDIS_KEYS.PUBLIC_EVENTS_CHANNEL);
    const received = new Promise<string>((resolve) => {
      subscriber.once('message', (_channel, message) => resolve(message));
    });

    await publishPublicEvent(publisher, 'session:stopped', 'sess-1');

    const message = parseChannelMessage(await received);
    expect(message).toMatchObject({ event: 'session:stopped', data: 'sess-1' });
    expect(Date.parse(message?.at ?? '')).not.toBeNaN();
  });
});
