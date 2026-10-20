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
  buildGenreItemsSql,
  buildGenreRowsSql,
  queryGenreDetail,
  queryGenreRows,
  resolveGenreWindow,
  type GenreScope,
  type GenreWindow,
} from '../genreStats.js';

const SERVER = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const LIBRARY = 'lib-movies';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const render = (fragment: SQL) => normalize(renderSql(fragment).sql);
const executed = () =>
  vi.mocked(db.execute).mock.calls.map(([query]) => renderSql(query as unknown as SQL));

const MONTH: GenreWindow = {
  period: 'month',
  range: { start: new Date('2026-09-19T00:00:00Z'), end: new Date('2026-10-19T00:00:00Z') },
  prior: { start: new Date('2026-08-20T00:00:00Z'), end: new Date('2026-09-19T00:00:00Z') },
};

const ALL: GenreWindow = {
  period: 'all',
  range: { start: null, end: new Date('2026-10-19T00:00:00Z') },
  prior: null,
};

function scopeFor(type: GenreScope['type'], scope: GenreScope['scope'] = 'all'): GenreScope {
  return { type, resolvedServerIds: undefined, scope, timezone: 'UTC' };
}

const MEMBER: GenreScope['scope'] = {
  userId: 'u-member',
  serverUserIds: [ACCOUNT],
  serverIds: [SERVER],
  libraryIds: { [SERVER]: [LIBRARY] },
};

// Answers each statement by what it reads, so the order of the parallel queries never matters.
function answer(rows: { items?: unknown[]; plays?: unknown[]; titles?: unknown[] }) {
  vi.mocked(db.execute).mockImplementation((async (query: SQL) => {
    const text = render(query);
    if (text.includes('AS list')) return { rows: rows.titles ?? [] };
    if (text.includes('total_items')) return { rows: rows.items ?? [] };
    if (text.includes('total_plays')) return { rows: rows.plays ?? [] };
    return { rows: [] };
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  answer({});
});

describe('resolveGenreWindow', () => {
  it('aligns a custom range to whole UTC days and includes its end day', () => {
    const window = resolveGenreWindow({
      period: 'custom',
      startDate: '2026-10-01T15:30:00.000Z',
      endDate: '2026-10-07T09:00:00.000Z',
    });
    expect(window.range).toEqual({
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2026-10-08T00:00:00Z'),
    });
    expect(window.prior).toEqual({
      start: new Date('2026-09-24T00:00:00Z'),
      end: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('reads a same-instant custom range as that one UTC day', () => {
    const window = resolveGenreWindow({
      period: 'custom',
      startDate: '2026-09-15T00:00:00.000Z',
      endDate: '2026-09-15T00:00:00.000Z',
    });
    expect(window.range).toEqual({
      start: new Date('2026-09-15T00:00:00Z'),
      end: new Date('2026-09-16T00:00:00Z'),
    });
  });
});

describe('buildGenreRowsSql', () => {
  it('groups chains before folding to genres so a show chain spanning two UTC days counts once', () => {
    const text = render(buildGenreRowsSql(scopeFor('show'), MONTH));
    const chains = text.indexOf('chains AS (');
    const grouped = text.indexOf('GROUP BY p.chain_id');
    const unnest = text.indexOf('unnest(canon.genres)');
    expect(chains).toBeGreaterThan(-1);
    expect(grouped).toBeGreaterThan(chains);
    expect(unnest).toBeGreaterThan(grouped);
    expect(text).toContain('p.show_media_id IS NOT NULL');
  });

  it('folds alias rows onto the canonical title for movie and show', () => {
    for (const type of ['movie', 'show'] as const) {
      const { sql: text, params } = renderSql(buildGenreRowsSql(scopeFor(type), MONTH));
      expect(normalize(text)).toContain('COALESCE(pmr.merged_into_id, pmr.id)');
      expect(params).toContain(type);
    }
  });

  it('keys artists on the canonical media row and rolls track plays up through grandparent_rating_key', () => {
    const { sql: text, params } = renderSql(buildGenreRowsSql(scopeFor('artist'), MONTH));
    const rows = normalize(text);
    expect(rows).toContain('ar.rating_key = t.grandparent_rating_key');
    expect(rows).toContain('JOIN media pmr ON pmr.id = ar.media_id');
    expect(rows).toContain('COALESCE(pmr.merged_into_id, pmr.id)');
    expect(rows).toContain('unnest(canon.genres)');
    expect(rows).not.toContain('unnest(ar.genres)');
    expect(params).toContain('artist');

    const items = render(buildGenreItemsSql(scopeFor('artist')));
    expect(items).toContain('FROM media m WHERE m.merged_into_id IS NULL');
    expect(items).toContain("ar.media_id = i.id AND t.media_type = 'track'");
    expect(items).toContain('unnest(sized.genres)');
  });

  it('returns priorPlays null and no prior series for period=all', async () => {
    answer({
      items: [
        {
          total_items: 2,
          genre: 'Drama',
          item_count: 2,
          size_bytes: '10',
          never_played_count: 0,
          never_played_bytes: '0',
        },
      ],
      plays: [
        {
          total_plays: 4,
          total_prior_plays: 0,
          genre: 'Drama',
          plays: 4,
          prior_plays: 0,
          watched_ms: '100',
          finished: 1,
          judged: 2,
          trend: [0, 0, 0, 0, 0, 0, 4],
          viewers: null,
        },
      ],
    });

    const response = await queryGenreRows(scopeFor('movie'), ALL);

    expect(render(buildGenreRowsSql(scopeFor('movie'), ALL))).not.toContain('first_day >=');
    expect(response.data[0]).toMatchObject({
      genre: 'Drama',
      plays: 4,
      priorPlays: null,
      finishedRate: 50,
    });
    expect(response.totals.priorPlays).toBeNull();
    expect(response.range).toEqual({
      start: null,
      end: '2026-10-19T00:00:00.000Z',
      priorStart: null,
      priorEnd: null,
    });
  });
});

describe('buildGenreItemsSql', () => {
  it('counts never played with the dead-weight predicate (no counted chain on the title or its aliases)', () => {
    const text = render(buildGenreItemsSql(scopeFor('movie')));
    expect(text).toContain(
      'NOT EXISTS ( SELECT 1 FROM user_media_plays_daily p WHERE p.media_id = i.id AND p.counted'
    );
    expect(text).toContain('WHERE loser.merged_into_id = i.id AND p2.counted');
    expect(text).toContain('m.merged_into_id IS NULL');
  });
});

describe('member scope', () => {
  it('applies libraryFragment to items and scopeFragment to plays for a member, and nulls topViewer when the member cannot see server activity', async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    answer({
      items: [
        {
          total_items: 1,
          genre: 'Drama',
          item_count: 1,
          size_bytes: '10',
          never_played_count: 0,
          never_played_bytes: '0',
        },
      ],
      plays: [
        {
          total_plays: 2,
          total_prior_plays: 1,
          genre: 'Drama',
          plays: 2,
          prior_plays: 1,
          watched_ms: '100',
          finished: 0,
          judged: 0,
          trend: [0, 0, 0, 0, 0, 0, 2],
          viewers: [{ userId: 'u-member', serverUserId: ACCOUNT, name: 'Mia', plays: 2 }],
        },
      ],
    });

    const response = await queryGenreRows(scopeFor('movie', MEMBER), MONTH);

    const [items, plays] = [
      executed().find((q) => q.sql.includes('total_items')),
      executed().find((q) => q.sql.includes('total_plays')),
    ];
    expect(items?.sql).toContain('li.library_id IN');
    expect(items?.params).toContain(LIBRARY);
    expect(plays?.sql).toContain('p.server_user_id IN');
    expect(plays?.params).toContain(ACCOUNT);
    expect(response.data[0]).toMatchObject({
      genre: 'Drama',
      plays: 2,
      topViewer: null,
      finishedRate: null,
    });
  });
});

describe('queryGenreDetail', () => {
  it("reads each top viewer's avatar from their busiest account", () => {
    const text = render(buildGenreRowsSql(scopeFor('movie'), MONTH, 'Drama'));
    expect(text).toContain("'thumbUrl', su.thumb_url");
    expect(text).toContain("'serverId', su.server_id");
  });

  it('detail: itemShare and playShare are the genre over the type totals, viewers carry their avatar', async () => {
    answer({
      items: [
        {
          total_items: 8,
          genre: 'Drama',
          item_count: 2,
          size_bytes: '500',
          never_played_count: 1,
          never_played_bytes: '200',
        },
      ],
      plays: [
        {
          total_plays: 40,
          total_prior_plays: 5,
          genre: 'Drama',
          plays: 10,
          prior_plays: 4,
          watched_ms: '1000',
          finished: 3,
          judged: 4,
          trend: [0, 0, 0, 0, 0, 0, 10],
          viewers: [
            {
              userId: 'u1',
              serverUserId: 'su1',
              name: 'Ana',
              thumbUrl: '/users/ana.png',
              serverId: SERVER,
              plays: 5,
            },
            {
              userId: 'u2',
              serverUserId: 'su2',
              name: 'Ben',
              thumbUrl: null,
              serverId: SERVER,
              plays: 2,
            },
            {
              userId: 'u3',
              serverUserId: 'su3',
              name: 'Cy',
              thumbUrl: null,
              serverId: SERVER,
              plays: 1,
            },
          ],
        },
      ],
      titles: [
        {
          list: 'top',
          id: 'm1',
          title: 'Heat',
          year: 1995,
          size_bytes: '300',
          plays: 6,
          thumb_path: '/t/1',
          server_id: SERVER,
        },
        {
          list: 'never',
          id: 'm2',
          title: 'Ran',
          year: 1985,
          size_bytes: '200',
          plays: 0,
          thumb_path: null,
          server_id: SERVER,
        },
      ],
    });

    const detail = await queryGenreDetail(scopeFor('movie'), MONTH, 'Drama');

    expect(detail?.kpis).toEqual({
      plays: 10,
      priorPlays: 4,
      finishedRate: 75,
      abandonedRate: 25,
      itemCount: 2,
      sizeBytes: 500,
      itemShare: 25,
      playShare: 25,
    });
    expect(detail?.topViewers.map((viewer) => viewer.share)).toEqual([50, 20, 10]);
    expect(detail?.topViewers[0]).toEqual({
      userId: 'u1',
      serverUserId: 'su1',
      name: 'Ana',
      thumbUrl: '/users/ana.png',
      serverId: SERVER,
      share: 50,
    });
    expect(detail).not.toHaveProperty('othersShare');
    expect(detail?.topTitles).toEqual([
      {
        mediaId: 'm1',
        title: 'Heat',
        year: 1995,
        serverId: SERVER,
        thumbPath: '/t/1',
        plays: 6,
        sizeBytes: 300,
      },
    ]);
    expect(detail?.neverPlayed.map((title) => title.mediaId)).toEqual(['m2']);
    expect(executed().some((q) => q.params.includes('Drama'))).toBe(true);
  });

  it('detail: returns null for a genre with no items of the type and no plays in the window', async () => {
    answer({ items: [{ total_items: 8, genre: null }] });

    expect(await queryGenreDetail(scopeFor('show'), MONTH, 'Western')).toBeNull();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('detail: answers for a genre with plays in the window and no items left', async () => {
    answer({
      items: [{ total_items: 8, genre: null }],
      plays: [
        {
          total_plays: 20,
          total_prior_plays: 0,
          genre: 'Western',
          plays: 5,
          prior_plays: 0,
          watched_ms: '500',
          finished: 0,
          judged: 0,
          trend: [0, 0, 0, 0, 0, 0, 5],
          viewers: null,
        },
      ],
    });

    const detail = await queryGenreDetail(scopeFor('show'), MONTH, 'Western');

    expect(detail?.kpis).toMatchObject({
      plays: 5,
      itemCount: 0,
      sizeBytes: 0,
      itemShare: null,
      playShare: 25,
    });
    expect(detail?.topTitles).toEqual([]);
  });
});
