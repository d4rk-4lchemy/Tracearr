import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../librarySync.js', () => ({
  librarySyncService: {
    tombstoneItemsByRatingKey: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../jobs/librarySyncQueue.js', () => ({
  enqueueLibrarySyncFromEvent: vi.fn().mockResolvedValue(undefined),
}));

import { librarySyncService } from '../librarySync.js';
import { enqueueLibrarySyncFromEvent } from '../../jobs/librarySyncQueue.js';
import { recordLibraryEvent, clearPendingLibraryEventSyncs } from '../libraryEventSync.js';

const tombstoneMock = vi.mocked(librarySyncService.tombstoneItemsByRatingKey);
const enqueueMock = vi.mocked(enqueueLibrarySyncFromEvent);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  clearPendingLibraryEventSyncs();
  vi.useRealTimers();
});

describe('recordLibraryEvent debounce', () => {
  it('does not enqueue a sync before the debounce window closes', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('enqueues one sync 30s after the first event in a burst', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'b' });
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'c' });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith('srv-1');
  });

  it('does not reset the window on later events (fires 30s after the first, not the last)', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });

    await vi.advanceTimersByTimeAsync(20_000);
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'b' });

    // Total elapsed since the first event is 30s even though a second event
    // landed at 20s - the window must not have been pushed back to 50s.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh window for a new burst after the first one closes', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'b' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it('tracks debounce windows independently per server', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });
    await vi.advanceTimersByTimeAsync(15_000);
    recordLibraryEvent({ serverId: 'srv-2', serverName: 'Server 2', type: 'added', itemId: 'b' });

    await vi.advanceTimersByTimeAsync(15_000); // t=30s: srv-1 fires, srv-2 does not
    expect(enqueueMock).toHaveBeenCalledWith('srv-1');
    expect(enqueueMock).not.toHaveBeenCalledWith('srv-2');

    await vi.advanceTimersByTimeAsync(15_000); // t=45s: srv-2 fires
    expect(enqueueMock).toHaveBeenCalledWith('srv-2');
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it('does not let enqueue failures throw out of the timer callback', async () => {
    enqueueMock.mockRejectedValueOnce(new Error('queue unavailable'));
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('clearPendingLibraryEventSyncs cancels windows without enqueuing', async () => {
    recordLibraryEvent({ serverId: 'srv-1', serverName: 'Server 1', type: 'added', itemId: 'a' });
    clearPendingLibraryEventSyncs();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('recordLibraryEvent tombstoning', () => {
  it('tombstones immediately on a removal event with an item id', () => {
    recordLibraryEvent({
      serverId: 'srv-1',
      serverName: 'Server 1',
      type: 'removed',
      itemId: 'rk-123',
    });

    expect(tombstoneMock).toHaveBeenCalledWith('srv-1', ['rk-123']);
  });

  it('does not tombstone on an added event', () => {
    recordLibraryEvent({
      serverId: 'srv-1',
      serverName: 'Server 1',
      type: 'added',
      itemId: 'rk-123',
    });

    expect(tombstoneMock).not.toHaveBeenCalled();
  });

  it('does not tombstone a removal event without a resolvable item id', () => {
    recordLibraryEvent({
      serverId: 'srv-1',
      serverName: 'Server 1',
      type: 'removed',
      itemId: null,
    });

    expect(tombstoneMock).not.toHaveBeenCalled();
  });

  it('still schedules a sync for a removal event with no item id (tombstone skipped, sync still covers it)', async () => {
    recordLibraryEvent({
      serverId: 'srv-1',
      serverName: 'Server 1',
      type: 'removed',
      itemId: null,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(enqueueMock).toHaveBeenCalledWith('srv-1');
  });

  it('does not let a tombstone failure throw synchronously', () => {
    tombstoneMock.mockRejectedValueOnce(new Error('db unavailable'));

    expect(() =>
      recordLibraryEvent({
        serverId: 'srv-1',
        serverName: 'Server 1',
        type: 'removed',
        itemId: 'rk-1',
      })
    ).not.toThrow();
  });
});
