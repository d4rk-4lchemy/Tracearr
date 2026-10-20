/**
 * selectGrowthFit: the growth regression must never fit across the
 * multi-version changeover stamp. Post-stamp data wins once it spans the
 * minimum; until then the pre-stamp side stands in for the slope while
 * postDaysSpanned keeps driving the predictions countdown.
 *
 * GET /storage with db.execute mocked: which window reaches the SQL, and the
 * per-library rows.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { AuthUser } from '@tracearr/shared';
import { renderSql } from '../../../test/helpers.js';

vi.mock('../../../db/client.js', () => ({ db: { execute: vi.fn() } }));
vi.mock('../../../services/settings.js', () => ({ getSetting: vi.fn() }));

import { db } from '../../../db/client.js';
import { permissionGuard } from '../../../lib/scope.js';
import { libraryStorageRoute, selectGrowthFit } from '../storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 6, 1);

function rows(count: number, startOffsetDays = 0): Array<{ day: string }> {
  return Array.from({ length: count }, (_, i) => ({
    day: new Date(BASE + (startOffsetDays + i) * DAY_MS).toISOString().slice(0, 10),
  }));
}

const stampAt = (offsetDays: number) => BASE + offsetDays * DAY_MS;

describe('selectGrowthFit', () => {
  it('fits the full window when no stamp is set', () => {
    const input = rows(30);
    const fit = selectGrowthFit(input, null, 7);
    expect(fit.fitRows).toEqual(input);
    expect(fit.basis).toBe('current');
    expect(fit.postDaysSpanned).toBe(30);
  });

  it('fits the full window when every row is post-stamp', () => {
    const input = rows(30, 10);
    const fit = selectGrowthFit(input, stampAt(5), 7);
    expect(fit.fitRows).toEqual(input);
    expect(fit.basis).toBe('current');
    expect(fit.postDaysSpanned).toBe(30);
  });

  it('clamps to the post-stamp side once it spans the minimum', () => {
    const input = rows(30);
    const fit = selectGrowthFit(input, stampAt(20), 7);
    expect(fit.basis).toBe('current');
    expect(fit.fitRows).toHaveLength(10);
    expect(fit.fitRows[0]!.day).toBe('2026-07-21');
    expect(fit.postDaysSpanned).toBe(10);
  });

  it('falls back to the pre-stamp side while the post side is short', () => {
    const input = rows(30);
    const fit = selectGrowthFit(input, stampAt(27), 7);
    expect(fit.basis).toBe('preChangeover');
    expect(fit.fitRows).toHaveLength(27);
    expect(fit.fitRows[fit.fitRows.length - 1]!.day).toBe('2026-07-27');
    // The countdown still reports the post side
    expect(fit.postDaysSpanned).toBe(3);
  });

  it('stays on the short post side when both sides are short', () => {
    const input = rows(8);
    const fit = selectGrowthFit(input, stampAt(4), 7);
    expect(fit.basis).toBe('current');
    expect(fit.fitRows).toHaveLength(4);
    expect(fit.postDaysSpanned).toBe(4);
  });

  it('handles an empty window', () => {
    const fit = selectGrowthFit([], stampAt(5), 7);
    expect(fit.fitRows).toEqual([]);
    expect(fit.basis).toBe('current');
    expect(fit.postDaysSpanned).toBe(0);
  });
});

describe('GET /library/storage', () => {
  async function getStorage(url: string) {
    const owner: AuthUser = {
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    };
    const app = Fastify({ logger: false });
    await app.register(sensible);
    app.decorate('authenticate', async (request: { user: AuthUser }) => {
      request.user = owner;
    });
    app.decorate('requirePermission', permissionGuard(app));
    app.decorate('redis', { get: vi.fn(async () => null), setex: vi.fn() } as never);
    await app.register(libraryStorageRoute, { prefix: '/library' });
    const response = await app.inject({ method: 'GET', url });
    await app.close();
    expect(response.statusCode).toBe(200);
    return response;
  }

  async function storageQueryParams(url: string): Promise<unknown[]> {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
    await getStorage(url);
    const main = vi
      .mocked(db.execute)
      .mock.calls.map((call) => renderSql(call[0] as never))
      .find((query) => query.sql.includes('WITH date_series AS'));
    return main?.params ?? [];
  }

  it('reads the custom startDate/endDate window instead of the period token', async () => {
    const params = await storageQueryParams(
      '/library/storage?period=30d&startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-15T00:00:00.000Z'
    );
    expect(params).toEqual(
      expect.arrayContaining(['2026-09-01T00:00:00.000Z', '2026-09-14T23:59:59.999Z'])
    );
    expect(params).not.toContain('2026-09-15T00:00:00.000Z');
  });

  it('keeps the period token when no dates are given', async () => {
    const before = Date.now();
    const [start, end] = await storageQueryParams('/library/storage?period=90d');
    expect(Math.abs(new Date(String(start)).getTime() - (before - 90 * DAY_MS))).toBeLessThan(
      60_000
    );
    expect(Math.abs(new Date(String(end)).getTime() - before)).toBeLessThan(60_000);
  });

  it('lists every library of the server with its live item count and bytes', async () => {
    const serverId = randomUUID();
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockImplementation((async (query: never) =>
      renderSql(query).sql.includes('FROM libraries l')
        ? {
            rows: [
              {
                libraryId: '1',
                name: 'Movies',
                mediaType: 'movie',
                itemCount: 2,
                sizeBytes: '3000',
              },
              { libraryId: '7', name: 'Music', mediaType: 'artist', itemCount: 0, sizeBytes: '0' },
            ],
          }
        : { rows: [] }) as never);

    const response = await getStorage(`/library/storage?serverId=${serverId}`);

    expect(response.json().libraries).toEqual([
      { libraryId: '1', name: 'Movies', mediaType: 'movie', itemCount: 2, sizeBytes: 3000 },
      { libraryId: '7', name: 'Music', mediaType: 'artist', itemCount: 0, sizeBytes: 0 },
    ]);
    const librariesQuery = vi
      .mocked(db.execute)
      .mock.calls.map((call) => renderSql(call[0] as never))
      .find((query) => query.sql.includes('FROM libraries l'));
    expect(librariesQuery?.sql).toContain('LEFT JOIN');
    expect(librariesQuery?.sql).toContain('v.file_size > 0');
    expect(librariesQuery?.params).toContain(serverId);
  });
});
