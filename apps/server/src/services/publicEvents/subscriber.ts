/**
 * One subscriber per process on the public channel, on its own connection
 * because a subscribed ioredis client can run no other command. It starts
 * with the first open connection and stops with the last. The returned
 * promise resolves true when the SUBSCRIBE is acknowledged, so callers can
 * hold ready and the cache seed until events can actually arrive. ioredis
 * reconnects and resubscribes by itself; every ready after the first is
 * reported so open connections can tell their clients to refetch. ioredis
 * only resubscribes a channel whose SUBSCRIBE was acknowledged, so a failed
 * one stops the subscriber and resolves false.
 */

import { REDIS_KEYS } from '@tracearr/shared';
import { parseChannelMessage, type ChannelMessage } from './channel.js';
import type { Redis } from 'ioredis';

export interface SubscriberHandlers {
  onMessage: (message: ChannelMessage) => void;
  onResubscribe: () => void;
  onError: (err: unknown) => void;
}

let client: Redis | null = null;
let subscribed: Promise<boolean> | null = null;
let generation = 0;

export function startSubscriber(base: Redis, handlers: SubscriberHandlers): Promise<boolean> {
  if (client && subscribed) return subscribed;
  generation += 1;
  const gen = generation;
  const sub = base.duplicate();
  client = sub;
  let readyCount = 0;

  sub.on('error', (err: unknown) => {
    if (gen === generation) handlers.onError(err);
  });
  sub.on('ready', () => {
    if (gen !== generation) return;
    readyCount += 1;
    if (readyCount > 1) handlers.onResubscribe();
  });
  sub.on('message', (channel: string, raw: string) => {
    if (gen !== generation || channel !== REDIS_KEYS.PUBLIC_EVENTS_CHANNEL) return;
    const message = parseChannelMessage(raw);
    if (message) handlers.onMessage(message);
  });
  subscribed = sub
    .subscribe(REDIS_KEYS.PUBLIC_EVENTS_CHANNEL)
    .then(() => gen === generation)
    .catch((err: unknown) => {
      if (gen !== generation) return false;
      handlers.onError(err);
      stopSubscriber();
      return false;
    });
  return subscribed;
}

export function stopSubscriber(): void {
  if (!client) return;
  generation += 1;
  client.disconnect();
  client = null;
  subscribed = null;
}

export function subscriberRunning(): boolean {
  return client !== null;
}
