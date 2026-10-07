import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicEvent, PublicEventType } from '../../../routes/publicV2/eventsTranslate.js';
import type { SubscriberHandlers } from '../subscriber.js';

const { mockAdmit, mockTouch, mockRelease, mockStart, mockStop, subscriber } = vi.hoisted(() => ({
  mockAdmit: vi.fn(async () => true),
  mockTouch: vi.fn(async () => undefined),
  mockRelease: vi.fn(async () => undefined),
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  subscriber: {
    handlers: null as null | SubscriberHandlers,
    // Set by a test that needs to hold the subscribe open; null means resolve at once.
    subscribed: null as null | Promise<boolean>,
  },
}));

vi.mock('../registry.js', () => ({
  admitConnection: (...args: unknown[]) => mockAdmit(...(args as [])),
  touchConnections: (...args: unknown[]) => mockTouch(...(args as [])),
  releaseConnection: (...args: unknown[]) => mockRelease(...(args as [])),
}));
vi.mock('../subscriber.js', () => ({
  startSubscriber: (_base: unknown, handlers: SubscriberHandlers) => {
    subscriber.handlers = handlers;
    mockStart();
    return subscriber.subscribed ?? Promise.resolve(true);
  },
  stopSubscriber: () => {
    subscriber.handlers = null;
    mockStop();
  },
  subscriberRunning: () => subscriber.handlers !== null,
}));

import {
  COALESCE_MS,
  HEARTBEAT_MS,
  MAX_LIFETIME_MS,
  MAX_CONNECTIONS_PER_INSTANCE,
  MAX_CONNECTIONS_PER_KEY,
  WRITE_BUFFER_LIMIT_BYTES,
  admitPublicEventConnection,
  attachPublicEventConnection,
  closeAllPublicEventConnections,
  closePublicEventConnectionsForUser,
  deliverToConnection,
  formatFrame,
  getPublicEventConnectionStats,
  initPublicEventConnections,
  readyFrame,
  resetPublicEventConnectionsForTests,
  type ConnectionSink,
} from '../connections.js';

function fakeSink(writableLength = 0) {
  const closeHandlers: Array<() => void> = [];
  const sink = {
    chunks: [] as string[],
    ended: false,
    destroyed: false,
    writableLength,
    writableEnded: false,
    write(chunk: string) {
      sink.chunks.push(chunk);
      return true;
    },
    end() {
      sink.ended = true;
      sink.writableEnded = true;
      for (const cb of closeHandlers) cb();
    },
    destroy() {
      sink.destroyed = true;
      for (const cb of closeHandlers) cb();
    },
    on(_event: 'close', cb: () => void) {
      closeHandlers.push(cb);
      return sink;
    },
  };
  return sink as typeof sink & ConnectionSink;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function event(partial: Partial<PublicEvent>): PublicEvent {
  return {
    type: 'stream.started',
    at: '2026-10-06T10:00:00.000Z',
    serverId: 'srv-1',
    streamId: 'sess-1',
    data: { id: 'sess-1' },
    ...partial,
  };
}

const ALL_TYPES = new Set<PublicEventType>([
  'stream.started',
  'stream.updated',
  'stream.progress',
  'stream.stopped',
  'violation.created',
  'server.health',
]);

// Attaches and waits for the retry and ready frames, then forgets them so the
// tests below count only what they deliver; the frames have their own test.
async function open(
  connId: string,
  overrides: Partial<Parameters<typeof attachPublicEventConnection>[0]> = {}
) {
  const sink = fakeSink();
  await attachPublicEventConnection({
    connId,
    userId: 'u1',
    ip: '127.0.0.1',
    types: ALL_TYPES,
    serverId: null,
    sink,
    ...overrides,
  });
  sink.chunks.length = 0;
  return sink;
}

describe('public event connections', () => {
  const seedLastSeen = vi.fn();
  const clearLastSeen = vi.fn();
  const getActiveSessions = vi.fn(async () => [{ id: 'cached-1' }] as never[]);

  beforeEach(() => {
    vi.useFakeTimers();
    resetPublicEventConnectionsForTests();
    subscriber.subscribed = null;
    seedLastSeen.mockClear();
    clearLastSeen.mockClear();
    getActiveSessions.mockClear();
    initPublicEventConnections({
      redis: {} as never,
      log: log as never,
      translate: () => null,
      getActiveSessions,
      seedLastSeen,
      clearLastSeen,
    });
  });

  afterEach(() => {
    closeAllPublicEventConnections('shutdown');
    vi.useRealTimers();
  });

  it('formats event and the envelope in data, with no id field', () => {
    expect(formatFrame(event({}))).toBe(
      'event: stream.started\ndata: {"type":"stream.started","at":"2026-10-06T10:00:00.000Z","data":{"id":"sess-1"}}\n\n'
    );
    expect(readyFrame('2026-10-06T10:00:00.000Z')).toBe(
      'event: ready\ndata: {"type":"ready","at":"2026-10-06T10:00:00.000Z","data":{}}\n\n'
    );
  });

  it('writes retry and ready only once the subscribe is acknowledged', async () => {
    let acknowledge: () => void = () => undefined;
    subscriber.subscribed = new Promise<boolean>((resolve) => {
      acknowledge = () => resolve(true);
    });
    const sink = fakeSink();
    const attached = attachPublicEventConnection({
      connId: 'a',
      userId: 'u1',
      ip: '127.0.0.1',
      types: ALL_TYPES,
      serverId: null,
      sink,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.chunks).toEqual([]);
    expect(getActiveSessions).not.toHaveBeenCalled();

    acknowledge();
    await attached;
    expect(sink.chunks[0]).toBe('retry: 5000\n\n');
    expect(sink.chunks[1]).toMatch(/^event: ready\ndata: \{"type":"ready","at":"/);
    expect(sink.chunks).toHaveLength(2);
  });

  it('a failed first subscribe closes the waiting connections without ready and stops the subscriber', async () => {
    let fail: () => void = () => undefined;
    subscriber.subscribed = new Promise<boolean>((resolve) => {
      fail = () => resolve(false);
    });
    const a = fakeSink();
    const b = fakeSink();
    const input = { userId: 'u1', ip: '127.0.0.1', types: ALL_TYPES, serverId: null };
    const attachedA = attachPublicEventConnection({ ...input, connId: 'a', sink: a });
    const attachedB = attachPublicEventConnection({ ...input, connId: 'b', sink: b });
    await vi.advanceTimersByTimeAsync(0);

    fail();
    await Promise.all([attachedA, attachedB]);
    expect(a.ended).toBe(true);
    expect(b.ended).toBe(true);
    expect(a.chunks).toEqual([]);
    expect(b.chunks).toEqual([]);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(getActiveSessions).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ connId: 'a', reason: 'maintenance' }),
      expect.any(String)
    );

    subscriber.subscribed = null;
    await open('c');
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('a subscribe that fails after its connections left does not close the next ones', async () => {
    let failStale: () => void = () => undefined;
    subscriber.subscribed = new Promise<boolean>((resolve) => {
      failStale = () => resolve(false);
    });
    const first = fakeSink();
    const attachedFirst = attachPublicEventConnection({
      connId: 'a',
      userId: 'u1',
      ip: '127.0.0.1',
      types: ALL_TYPES,
      serverId: null,
      sink: first,
    });
    first.end();

    subscriber.subscribed = null;
    const next = await open('b');
    failStale();
    await attachedFirst;
    expect(next.ended).toBe(false);
    expect(getPublicEventConnectionStats().open).toBe(1);
  });

  it('refuses the instance cap before asking Redis, and reports a key cap', async () => {
    for (let i = 0; i < MAX_CONNECTIONS_PER_INSTANCE; i += 1) await open(`c${i}`);
    expect(await admitPublicEventConnection('u1', 'extra')).toBe('instance_cap');
    expect(mockAdmit).not.toHaveBeenCalled();

    closeAllPublicEventConnections('shutdown');
    mockAdmit.mockResolvedValueOnce(false);
    expect(await admitPublicEventConnection('u1', 'x')).toBe('key_cap');
    expect(mockAdmit).toHaveBeenCalledWith({}, 'u1', 'x', MAX_CONNECTIONS_PER_KEY);
  });

  it('starts the subscriber with the first connection and stops it with the last', async () => {
    const a = await open('a');
    expect(mockStart).toHaveBeenCalledTimes(1);
    await open('b');
    expect(mockStart).toHaveBeenCalledTimes(1);
    a.end();
    expect(mockStop).not.toHaveBeenCalled();
    closeAllPublicEventConnections('shutdown');
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('clears the translator snapshots when the last connection closes', async () => {
    const a = await open('a');
    await open('b');
    a.end();
    expect(clearLastSeen).not.toHaveBeenCalled();
    closeAllPublicEventConnections('shutdown');
    expect(clearLastSeen).toHaveBeenCalledTimes(1);
  });

  it('seeds the translator from the session cache once, after the subscribe is acknowledged', async () => {
    let acknowledge: () => void = () => undefined;
    subscriber.subscribed = new Promise<boolean>((resolve) => {
      acknowledge = () => resolve(true);
    });
    const attached = open('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(getActiveSessions).not.toHaveBeenCalled();

    acknowledge();
    await attached;
    expect(getActiveSessions).toHaveBeenCalledTimes(1);
    expect(seedLastSeen).toHaveBeenCalledWith([{ id: 'cached-1' }]);

    await open('b');
    expect(getActiveSessions).toHaveBeenCalledTimes(1);
  });

  it('a failed seed read is logged and the connection stays open', async () => {
    getActiveSessions.mockRejectedValueOnce(new Error('redis down'));
    const sink = await open('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(seedLastSeen).not.toHaveBeenCalled();
    expect(sink.ended).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String)
    );
  });

  it('a subscriber resubscribe sends ready to every open connection', async () => {
    const a = await open('a');
    const b = await open('b', { userId: 'u2' });
    subscriber.handlers?.onResubscribe();
    expect(a.chunks.filter((c) => c.startsWith('event: ready'))).toHaveLength(1);
    expect(b.chunks.filter((c) => c.startsWith('event: ready'))).toHaveLength(1);
  });

  it('a key-changed message closes that user and an event message fans out', async () => {
    initPublicEventConnections({
      redis: {} as never,
      log: log as never,
      translate: (message) =>
        message.event === 'public-api:key-changed'
          ? { kind: 'key-changed', userId: 'u1' }
          : { kind: 'events', events: [event({ type: 'server.health', streamId: null })] },
      getActiveSessions,
      seedLastSeen,
      clearLastSeen,
    });
    const mine = await open('a');
    const theirs = await open('b', { userId: 'u2' });
    subscriber.handlers?.onMessage({ event: 'server:up', data: {}, at: 'x' });
    expect(mine.chunks.some((c) => c.includes('event: server.health'))).toBe(true);
    expect(theirs.chunks.some((c) => c.includes('event: server.health'))).toBe(true);
    subscriber.handlers?.onMessage({ event: 'public-api:key-changed', data: {}, at: 'x' });
    expect(mine.ended).toBe(true);
    expect(theirs.ended).toBe(false);
  });

  it('a message the translator throws on is logged and dropped, and the next one still arrives', async () => {
    initPublicEventConnections({
      redis: {} as never,
      log: log as never,
      translate: (message) => {
        if (message.event === 'session:started') throw new TypeError('bad payload');
        return { kind: 'events', events: [event({ type: 'server.health', streamId: null })] };
      },
      getActiveSessions,
      seedLastSeen,
      clearLastSeen,
    });
    const sink = await open('a');
    subscriber.handlers?.onMessage({ event: 'session:started', data: { id: 1 }, at: 'x' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(TypeError), event: 'session:started' }),
      expect.any(String)
    );
    expect(sink.chunks).toEqual([]);

    subscriber.handlers?.onMessage({ event: 'server:up', data: {}, at: 'x' });
    expect(sink.chunks.some((c) => c.includes('event: server.health'))).toBe(true);
    expect(sink.ended).toBe(false);
  });

  it('filters by type and server, and lets an unknown-server stop through', async () => {
    const sink = await open('a', {
      types: new Set<PublicEventType>(['stream.stopped']),
      serverId: 'srv-1',
    });
    deliverToConnection('a', event({ type: 'stream.started', serverId: 'srv-1' }));
    deliverToConnection('a', event({ type: 'stream.stopped', serverId: 'srv-2' }));
    deliverToConnection('a', event({ type: 'stream.stopped', serverId: null, streamId: 'ghost' }));
    deliverToConnection('a', event({ type: 'stream.stopped', serverId: 'srv-1' }));
    expect(sink.chunks.filter((c) => c.includes('event: stream.stopped'))).toHaveLength(2);
    expect(sink.chunks.some((c) => c.includes('event: stream.started'))).toBe(false);
  });

  it('coalesces per type and stream within the flush window, so an update never loses to progress', async () => {
    const sink = await open('a');
    deliverToConnection(
      'a',
      event({ type: 'stream.updated', data: { id: 'sess-1', state: 'playing' } })
    );
    deliverToConnection('a', event({ type: 'stream.progress', data: { progress_ms: 1 } }));
    deliverToConnection('a', event({ type: 'stream.progress', data: { progress_ms: 2 } }));
    deliverToConnection(
      'a',
      event({ type: 'stream.progress', streamId: 'other', data: { progress_ms: 9 } })
    );
    expect(sink.chunks).toHaveLength(0);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sink.chunks).toHaveLength(3);
    expect(sink.chunks[0]).toContain('event: stream.updated');
    expect(sink.chunks[1]).toContain('"progress_ms":2');
    expect(sink.chunks[2]).toContain('"progress_ms":9');
  });

  it('a stop drops both pending slots for that stream and goes out at once', async () => {
    const sink = await open('a');
    deliverToConnection('a', event({ type: 'stream.updated' }));
    deliverToConnection('a', event({ type: 'stream.progress', data: { progress_ms: 5 } }));
    deliverToConnection(
      'a',
      event({ type: 'stream.progress', streamId: 'other', data: { progress_ms: 9 } })
    );
    deliverToConnection('a', event({ type: 'stream.stopped' }));
    expect(sink.chunks).toHaveLength(1);
    expect(sink.chunks[0]).toContain('event: stream.stopped');
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sink.chunks).toHaveLength(2);
    expect(sink.chunks[1]).toContain('"progress_ms":9');
  });

  it('writes a heartbeat comment, refreshes the registry, and destroys a slow consumer', async () => {
    const fast = await open('a');
    const slow = await open('b');
    slow.writableLength = WRITE_BUFFER_LIMIT_BYTES + 1;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(fast.chunks).toEqual([': ping\n\n']);
    expect(slow.destroyed).toBe(true);
    expect(mockTouch).toHaveBeenCalledWith({}, 'u1', ['a'], expect.any(Number));
    expect(getPublicEventConnectionStats()).toEqual({ open: 1, byUser: { u1: 1 } });
  });

  it('ends a connection at its maximum lifetime', async () => {
    const sink = await open('a');
    vi.advanceTimersByTime(MAX_LIFETIME_MS + HEARTBEAT_MS);
    expect(sink.ended).toBe(true);
    expect(mockRelease).toHaveBeenCalledWith({}, 'u1', 'a');
  });

  it('closes every connection for a user whose key changed and leaves others open', async () => {
    const mine = await open('a');
    const theirs = await open('b', { userId: 'u2' });
    closePublicEventConnectionsForUser('u1', 'key_changed');
    expect(mine.ended).toBe(true);
    expect(theirs.ended).toBe(false);
    expect(getPublicEventConnectionStats().byUser).toEqual({ u2: 1 });
  });

  it('a client disconnect releases the registry slot and logs the reason', async () => {
    const sink = await open('a');
    sink.end();
    expect(mockRelease).toHaveBeenCalledWith({}, 'u1', 'a');
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ connId: 'a', reason: 'client' }),
      expect.any(String)
    );
    expect(getPublicEventConnectionStats().open).toBe(0);
  });

  it('never grows past the instance cap even when the registry says yes', async () => {
    for (let i = 0; i < MAX_CONNECTIONS_PER_INSTANCE; i += 1) await open(`c${i}`);
    await expect(open('one-more')).rejects.toThrow();
    expect(getPublicEventConnectionStats().open).toBe(MAX_CONNECTIONS_PER_INSTANCE);
  });
});
