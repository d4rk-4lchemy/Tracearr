import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatcharrClient } from '../dispatcharr/client.js';
import {
  parseSessionsFromCatchupStats,
  type DispatcharrCatchupProgramme,
  type DispatcharrCatchupSessionGroup,
} from '../dispatcharr/parser.js';

const NOW = Date.parse('2026-07-19T10:00:00Z');
const users = new Map([['7', { id: '7', username: 'Viewer', isAdmin: false }]]);
const originalProgramme: DispatcharrCatchupProgramme = {
  title: 'Morning News',
  start_time: '2026-07-19T05:30:00Z',
  end_time: '2026-07-19T07:00:00Z',
  duration_secs: 5400,
};
const nextProgramme: DispatcharrCatchupProgramme = {
  title: 'Late News',
  start_time: '2026-07-19T07:00:00Z',
  end_time: '2026-07-19T08:00:00Z',
  duration_secs: 3600,
};

function group(overrides: Partial<DispatcharrCatchupSessionGroup> = {}) {
  return {
    session_id: 'catchup-1',
    channel_uuid: 'channel-1',
    channel_name: 'News Channel',
    programme_start: '2026-07-19:05-30',
    position_anchor_at: NOW / 1000,
    playback_base_secs: 5520,
    logo_id: 'logo-1',
    connections: [{ client_id: 'client-1', user_id: '7', user_agent: 'TiviMate' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Dispatcharr catch-up EPG lookup', () => {
  it.each([1, 51])(
    'keeps current and original programmes separate for %i sessions',
    async (count) => {
      const groups = Array.from({ length: count }, (_, index) =>
        group({ session_id: `catchup-${index}` })
      );
      let currentProgramme = originalProgramme;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const { sessions } = JSON.parse(String(init?.body)) as {
          sessions: Array<{ session_id: string; position_secs?: number }>;
        };
        expect(sessions.length).toBeLessThanOrEqual(50);
        expect(new Set(sessions.map((session) => session.session_id)).size).toBe(sessions.length);
        expect(new Set(sessions.map((session) => session.position_secs)).size).toBe(1);
        return new Response(
          JSON.stringify({
            sessions: sessions.map((request) => ({
              ...(request.position_secs === 0 ? originalProgramme : currentProgramme),
              session_id: request.session_id,
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      });
      const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'test-key' });
      const before = await client.buildSessionsFromCatchupStatsSnapshot(
        { timeshift_sessions: groups },
        users
      );
      expect(before).toHaveLength(count);
      expect(before[0]?.media.title).toBe('Morning News');

      currentProgramme = nextProgramme;
      const after = await client.buildSessionsFromCatchupStatsSnapshot(
        { timeshift_sessions: groups },
        users
      );
      expect(after).toHaveLength(count);
      for (const [index, session] of after.entries()) {
        expect(session).toMatchObject({
          sessionKey: before[index]?.sessionKey,
          terminationKey: before[index]?.terminationKey,
          mediaId: before[index]?.mediaId,
          player: { deviceId: 'client-1' },
          media: { title: 'Late News', durationMs: 3_600_000 },
          playback: { positionMs: 120_000 },
          dispatcharrCatchupAnchorAt: '2026-07-19T05:30:00.000Z',
          dispatcharrCatchupEpgStartAt: '2026-07-19T07:00:00.000Z',
          dispatcharrCatchupEpgEndAt: '2026-07-19T08:00:00.000Z',
          live: { channelThumb: '/api/channels/logos/logo-1/cache/' },
        });
      }
      expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(count / 50) * 4);
    }
  );

  it.each([200, 404])('keeps a catch-up connection without EPG (HTTP %i)', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ sessions: [] }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'test-key' });
    const sessions = await client.buildSessionsFromCatchupStatsSnapshot(
      { timeshift_sessions: [group()] },
      users
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionKey: 'catchup:catchup-1:channel-1',
      media: { title: 'News Channel', durationMs: 0 },
    });
    expect(sessions[0]?.dispatcharrCatchupEpgStartAt).toBeUndefined();
    expect(sessions[0]?.dispatcharrCatchupEpgEndAt).toBeUndefined();
  });
});

describe('Dispatcharr catch-up programme-relative progress', () => {
  it.each([
    { name: 'two minutes into the next programme', base: 5520, elapsed: 0, expected: 120 },
    { name: 'exact programme boundary', base: 5400, elapsed: 0, expected: 0 },
    { name: 'elapsed time after the anchor', base: 5400, elapsed: 120, expected: 120 },
    { name: 'paused playhead', base: 5520, elapsed: 300, paused: true, expected: 120 },
    { name: 'URL timestamp and elapsed time', elapsed: 5520, expected: 120 },
    { name: 'seek by URL', url: '2026-07-19:07-02', elapsed: 0, expected: 120 },
    { name: 'negative relative position', base: 30, elapsed: 0, expected: 0 },
    { name: 'future anchor', base: 5520, elapsed: -300, expected: 120 },
    { name: 'position beyond the EPG window', base: 10000, elapsed: 0, expected: 3600 },
    { name: 'multiple programme boundaries', base: 9120, elapsed: 0, hour: 8, expected: 120 },
  ])('$name', ({ base, elapsed, paused, url, hour, expected }) => {
    const currentProgramme = hour
      ? {
          ...nextProgramme,
          start_time: `2026-07-19T0${hour}:00:00Z`,
          end_time: '2026-07-19T09:00:00Z',
        }
      : nextProgramme;
    const sessions = parseSessionsFromCatchupStats(
      {
        timeshift_sessions: [
          group({
            playback_base_secs: base,
            position_anchor_at: NOW / 1000 - elapsed,
            paused,
            programme_start: url ?? '2026-07-19:05-30',
          }),
        ],
      },
      users,
      new Map([['catchup-1', currentProgramme]]),
      new Map([['catchup-1', originalProgramme]])
    );
    expect(sessions[0]?.playback.positionMs).toBe(expected * 1000);
    expect(sessions[0]?.playback.progressPercent).toBe(Math.round((expected / 3600) * 100));
  });
});
