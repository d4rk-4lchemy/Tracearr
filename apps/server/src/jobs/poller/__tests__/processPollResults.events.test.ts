import { describe, expect, it, vi } from 'vitest';
import { processPollResults } from '../sessionLifecycle.js';

describe('processPollResults event semantics', () => {
  it('publishes only session:updated for confirmed pending session transition', async () => {
    const session = {
      id: 'pending-stable-id',
      serverId: 'srv-1',
      sessionKey: 'sess-1',
      serverUserId: 'user-1',
    } as any;

    const publish = vi.fn().mockResolvedValue(undefined);
    const enqueueNotification = vi.fn().mockResolvedValue(undefined);

    await processPollResults({
      newSessions: [],
      stoppedKeys: new Set<string>(),
      updatedSessions: [session],
      cachedSessions: [],
      cacheService: null,
      pubSubService: {
        publish,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      },
      enqueueNotification,
    });

    expect(publish).toHaveBeenCalledWith('session:updated', session);
    expect(publish).not.toHaveBeenCalledWith('session:started', expect.anything());
    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_started' })
    );
  });
});
