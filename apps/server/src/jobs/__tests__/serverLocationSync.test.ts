import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';

vi.mock('../../db/client.js', () => ({ db: { transaction: vi.fn() } }));

import { db } from '../../db/client.js';
import { renderSql } from '../../test/helpers.js';
import { syncLocationBatch } from '../serverLocationSync.js';
import type { LocationRange } from '../../services/serverLocationRanges.js';

const PLACED: LocationRange = {
  from: null,
  to: null,
  location: {
    effectiveFrom: null,
    lat: 41.8781,
    lon: -87.6298,
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
  },
};
const UNPLACED: LocationRange = { from: null, to: null, location: null };

/** Call 0 is the decompression-cap GUC probe; an empty result skips the SET LOCAL */
function mockTransaction(selectRows: unknown[]) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: selectRows })
    .mockResolvedValue({ rows: [] });
  vi.mocked(db.transaction).mockImplementation((async (callback: (tx: unknown) => unknown) =>
    callback({ execute })) as never);
  return execute;
}

const rendered = (execute: ReturnType<typeof vi.fn>, call: number) =>
  renderSql(execute.mock.calls[call]?.[0] as SQL);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncLocationBatch', () => {
  it('compares and writes coordinates as real so repeated runs converge', async () => {
    const execute = mockTransaction([
      {
        id: 'a',
        started_at: '2026-01-02 10:00:00.123456+00',
        ip_address: '192.168.1.5',
        is_local: true,
      },
    ]);
    await syncLocationBatch('server-1', PLACED, null);
    expect(rendered(execute, 0).sql).toContain('FROM pg_settings');
    const select = rendered(execute, 1).sql;
    const update = rendered(execute, 2).sql;
    expect(select).toMatch(/geo_lat IS DISTINCT FROM \$\d+::real/);
    expect(select).toContain('s.geo_continent IS NOT NULL');
    expect(update).toMatch(/geo_lat = \$\d+::real/);
    expect(update).toContain('geo_continent = NULL');
  });

  it('writes the Local Network label and null coordinates when unplaced', async () => {
    const execute = mockTransaction([
      { id: 'a', started_at: '2026-01-02 10:00:00+00', ip_address: '10.0.0.4', is_local: true },
    ]);
    await syncLocationBatch('server-1', UNPLACED, null);
    const { sql: update, params } = rendered(execute, 2);
    expect(update).toContain('geo_lat = NULL::real');
    expect(params).toContain('Local Network');
  });

  it('only flags unclassified rows whose IP is public, leaving their geo alone', async () => {
    const execute = mockTransaction([
      {
        id: 'private',
        started_at: '2026-01-02 10:00:00+00',
        ip_address: '192.168.1.5',
        is_local: null,
      },
      { id: 'public', started_at: '2026-01-01 10:00:00+00', ip_address: '8.8.8.8', is_local: null },
    ]);
    const result = await syncLocationBatch('server-1', PLACED, null);
    expect(result.count).toBe(2);
    expect(rendered(execute, 2).sql).toContain("'private'::uuid");
    expect(rendered(execute, 2).sql).not.toContain("'public'::uuid");
    expect(rendered(execute, 3).sql).toContain('is_local = false');
    expect(rendered(execute, 3).sql).toContain("'public'::uuid");
  });

  it('bounds the update by the exact started_at text it selected', async () => {
    const execute = mockTransaction([
      {
        id: 'a',
        started_at: '2026-01-02 10:00:00.123456+00',
        ip_address: '192.168.1.5',
        is_local: true,
      },
      {
        id: 'b',
        started_at: '2026-01-01 09:00:00.654321+00',
        ip_address: '192.168.1.6',
        is_local: true,
      },
    ]);
    await syncLocationBatch('server-1', PLACED, null);
    expect(rendered(execute, 2).params).toEqual(
      expect.arrayContaining(['2026-01-01 09:00:00.654321+00', '2026-01-02 10:00:00.123456+00'])
    );
  });

  it('skips a window that does not overlap the range', async () => {
    const execute = mockTransaction([]);
    const range: LocationRange = { ...PLACED, from: new Date('2026-02-01T00:00:00Z') };
    const result = await syncLocationBatch('server-1', range, {
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-01-15T00:00:00Z'),
    });
    expect(result).toEqual({ count: 0, oldest: null });
    expect(execute).not.toHaveBeenCalled();
  });
});
