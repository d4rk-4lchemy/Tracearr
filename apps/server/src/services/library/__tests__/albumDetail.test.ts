import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { renderSql } from '../../../test/helpers.js';

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('../../settings.js', () => ({
  getSetting: vi.fn(),
}));

import { db } from '../../../db/client.js';
import { getSetting } from '../../settings.js';
import {
  albumChainsCte,
  albumCopiesSql,
  albumSummarySql,
  albumTracksSql,
  albumWindow,
  getAlbumDetail,
  type AlbumQuery,
} from '../albumDetail.js';

const ALBUM = '44444444-4444-4444-8444-444444444444';
const SERVER = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const render = (fragment: SQL) => normalize(renderSql(fragment).sql);

const MEMBER: AlbumQuery['scope'] = {
  userId: 'u-member',
  serverUserIds: [ACCOUNT],
  serverIds: [SERVER],
  libraryIds: { [SERVER]: ['lib-music'] },
};

const OWNER_QUERY: AlbumQuery = { aliases: [ALBUM], serverIds: undefined, scope: 'all' };
const NOW = new Date('2026-10-19T15:00:00Z');

function answer(rows: {
  copies?: unknown[];
  summary?: unknown[];
  listeners?: unknown[];
  tracks?: unknown[];
}) {
  vi.mocked(db.execute).mockImplementation((async (query: SQL) => {
    const text = render(query);
    if (text.includes('AS artist_media_id')) return { rows: rows.copies ?? [] };
    if (text.includes('AS all_plays')) return { rows: rows.summary ?? [] };
    if (text.includes('JOIN users u')) return { rows: rows.listeners ?? [] };
    if (text.includes('AS track_index')) return { rows: rows.tracks ?? [] };
    return { rows: [] };
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  answer({});
});

describe('albumWindow', () => {
  it('covers the last 30 UTC days with today and the 30 before them', () => {
    expect(albumWindow(NOW)).toEqual({
      start: new Date('2026-09-20T00:00:00Z'),
      priorStart: new Date('2026-08-21T00:00:00Z'),
    });
  });
});

describe('album SQL', () => {
  it("joins each copy's tracks and their track plays, one row per chain", () => {
    const text = render(albumChainsCte(OWNER_QUERY));
    expect(text).toContain("li.media_type = 'album' AND li.removed_at IS NULL");
    expect(text).toContain('c.server_id = t.server_id AND c.rating_key = t.parent_rating_key');
    expect(text).toContain("t.media_type = 'track'");
    expect(text).toContain('tm.server_id = p.server_id AND tm.media_id = p.media_id');
    expect(text).toContain("p.media_type = 'track'");
    expect(text).toContain('GROUP BY p.chain_id');
    expect(text).not.toContain('p.server_user_id IN');
  });

  it("narrows a member to their own plays and their libraries' copies", () => {
    const text = render(albumChainsCte({ ...OWNER_QUERY, scope: MEMBER }));
    expect(text).toContain('p.server_user_id IN');
    expect(text).toContain('li.library_id IN');
    expect(render(albumCopiesSql({ ...OWNER_QUERY, scope: MEMBER }, null))).toContain(
      'li.library_id IN'
    );
  });

  it('counts the window by first day and judges finishes with the shared test', () => {
    const text = render(albumSummarySql(OWNER_QUERY, albumWindow(NOW)));
    expect(text).toContain('COUNT(*) FILTER (WHERE counted AND first_day >=');
    expect(text).toContain('COALESCE(max_progress_ms, 0) >= content_duration_ms * 0.85');
  });

  it('dedupes tracks by number and title in album order', () => {
    const text = render(albumTracksSql(OWNER_QUERY));
    expect(text).toContain('GROUP BY t.item_index, t.title_key');
    expect(text).toContain('ORDER BY track_index ASC NULLS LAST, title');
  });
});

describe('getAlbumDetail', () => {
  const input = {
    ...OWNER_QUERY,
    album: { id: ALBUM, title: 'The Click', year: 2017 },
    preferredServerId: null,
    now: NOW,
  };

  it('is null when the album has no copy in scope', async () => {
    expect(await getAlbumDetail(input)).toBeNull();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('shapes the response, sharing listener plays out of all-time plays', async () => {
    answer({
      copies: [
        {
          server_id: SERVER,
          rating_key: '9001',
          year: null,
          parent_title: 'AJR',
          thumb_path: '/library/metadata/9001/thumb/1731801600',
          created_at: '2024-11-17T20:00:00.000Z',
          artist_media_id: 'artist-1',
        },
      ],
      summary: [
        { plays: 5, prior_plays: 4, listen_ms: '660000', all_plays: 8, finished: 6, judged: 8 },
      ],
      listeners: [
        { name: 'Becca', plays: 6 },
        { name: 'Sam', plays: 2 },
      ],
      tracks: [
        { track_index: 1, title: 'Overture', plays: 8, last_played: '2026-10-18T00:00:00.000Z' },
        { track_index: 2, title: 'The Good Part', plays: 0, last_played: null },
      ],
    });

    const detail = await getAlbumDetail(input);
    expect(detail?.album).toMatchObject({
      id: ALBUM,
      title: 'The Click',
      artistTitle: 'AJR',
      artistMediaId: 'artist-1',
      year: 2017,
      trackCount: 2,
      durationMs: null,
      addedAt: '2024-11-17T20:00:00.000Z',
      copies: [{ serverId: SERVER, ratingKey: '9001' }],
    });
    expect(detail?.album.posterUrl).toContain('width=360&height=360');
    expect(detail?.last30).toEqual({ plays: 5, priorPlays: 4, listenMs: 660000 });
    expect(detail?.allTime).toEqual({
      plays: 8,
      listeners: [
        { name: 'Becca', plays: 6, share: 75 },
        { name: 'Sam', plays: 2, share: 25 },
      ],
      finishedRate: 75,
    });
    expect(detail?.tracks[1]).toEqual({
      index: 2,
      title: 'The Good Part',
      durationMs: null,
      plays: 0,
      lastPlayedAt: null,
    });
  });

  it('names no listeners for a member without server activity', async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    answer({
      copies: [
        {
          server_id: SERVER,
          rating_key: '9001',
          year: 2017,
          parent_title: 'AJR',
          thumb_path: null,
          created_at: '2024-11-17T20:00:00.000Z',
          artist_media_id: null,
        },
      ],
      listeners: [{ name: 'Becca', plays: 6 }],
    });

    const detail = await getAlbumDetail({ ...input, scope: MEMBER });
    expect(detail?.allTime.listeners).toEqual([]);
    expect(detail?.album.posterUrl).toBeNull();
  });
});
