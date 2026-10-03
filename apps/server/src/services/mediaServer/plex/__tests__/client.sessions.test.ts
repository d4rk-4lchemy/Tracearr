import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as HttpModule from '../../../../utils/http.js';
import { PlexClient } from '../client.js';

vi.mock('../../../../utils/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  fetchJson: vi.fn(),
  plexHeaders: vi.fn().mockReturnValue({ 'X-Plex-Token': 'test-token' }),
}));

import { fetchJson } from '../../../../utils/http.js';

const mockFetchJson = vi.mocked(fetchJson);

function plexSession(opts: { sessionKey: string; ratingKey: string; transcoding: boolean }) {
  return {
    sessionKey: opts.sessionKey,
    ratingKey: opts.ratingKey,
    type: 'movie',
    title: `Movie ${opts.ratingKey}`,
    User: { id: '1', title: 'User1' },
    Player: { title: 'TV', machineIdentifier: `dev-${opts.sessionKey}`, state: 'playing' },
    ...(opts.transcoding && {
      TranscodeSession: { videoDecision: 'transcode', audioDecision: 'copy' },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlexClient.getSessions with a session key', () => {
  it('fetches metadata only for the requested session', async () => {
    mockFetchJson.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          plexSession({ sessionKey: '7', ratingKey: '70', transcoding: true }),
          plexSession({ sessionKey: '8', ratingKey: '80', transcoding: false }),
        ],
      },
    });
    const client = new PlexClient({ url: 'http://plex.local:32400', token: 'test-token' });

    const sessions = await client.getSessions('8');

    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(sessions.map((s) => s.sessionKey)).toEqual(['8']);
  });
});
