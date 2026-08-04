import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../client.js';
import {
  withSessionsCompressionPaused,
  isCompressionPolicyDegraded,
  retryDegradedCompressionPolicy,
  getTimescaleStatus,
  invalidateTimescaleStatusCache,
  coerceRefreshBound,
  safeFullRefreshAggregate,
  safeFullRefreshAllAggregates,
  shouldResumeBackfillInsteadOfRebuild,
} from '../timescale.js';

function executeMock() {
  return vi.mocked(db.execute) as unknown as ReturnType<typeof vi.fn>;
}

function executedSql(call: unknown[]): string {
  const arg = call[0] as {
    strings?: TemplateStringsArray;
    queryChunks?: Array<{ value?: string }>;
  };
  if (arg?.strings) return arg.strings.join('');
  if (arg?.queryChunks) return arg.queryChunks.map((c) => c.value ?? '').join('');
  return String(arg);
}

describe('withSessionsCompressionPaused', () => {
  beforeEach(() => {
    executeMock().mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the policy before the callback and restores it after', async () => {
    const order: string[] = [];
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('remove_compression_policy')) order.push('remove');
      if (sql.includes('add_compression_policy')) order.push('add');
      return Promise.resolve({ rows: [] }) as never;
    });

    const result = await withSessionsCompressionPaused(async () => {
      order.push('callback');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(order).toEqual(['remove', 'callback', 'add']);
  });

  it('restores the policy even when the callback throws', async () => {
    const calls: string[] = [];
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('remove_compression_policy')) calls.push('remove');
      if (sql.includes('add_compression_policy')) calls.push('add');
      return Promise.resolve({ rows: [] }) as never;
    });

    await expect(
      withSessionsCompressionPaused(async () => {
        throw new Error('import failed');
      })
    ).rejects.toThrow('import failed');

    expect(calls).toEqual(['remove', 'add']);
  });

  it('does not attempt to re-add the policy if removing it failed', async () => {
    let addAttempts = 0;
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('remove_compression_policy')) {
        return Promise.reject(new Error('extension not installed')) as never;
      }
      if (sql.includes('add_compression_policy')) {
        addAttempts++;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    const result = await withSessionsCompressionPaused(async () => 'still ran');

    expect(result).toBe('still ran');
    expect(addAttempts).toBe(0);
  });

  it('retries once and restores the policy without marking it degraded', async () => {
    let addAttempts = 0;
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('add_compression_policy')) {
        addAttempts++;
        if (addAttempts === 1) return Promise.reject(new Error('connection lost')) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await withSessionsCompressionPaused(async () => 'ok', 0);

    expect(addAttempts).toBe(2);
    // Recovering on the retry never writes the degraded-flag row.
    const insertedDegraded = executeMock().mock.calls.some((call) =>
      executedSql(call).includes('INSERT INTO timescale_metadata')
    );
    expect(insertedDegraded).toBe(false);
  });

  it('logs a recovery command and marks the policy degraded if both restore attempts fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('add_compression_policy')) {
        return Promise.reject(new Error('connection lost')) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await withSessionsCompressionPaused(async () => 'ok', 0);

    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(msg).toMatch(/add_compression_policy/);

    const insertedDegraded = executeMock().mock.calls.some((call) =>
      executedSql(call).includes('INSERT INTO timescale_metadata')
    );
    expect(insertedDegraded).toBe(true);
  });
});

describe('isCompressionPolicyDegraded / retryDegradedCompressionPolicy', () => {
  beforeEach(() => {
    executeMock().mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports not degraded when no flag row exists', async () => {
    executeMock().mockImplementation(() => Promise.resolve({ rows: [] }) as never);

    expect(await isCompressionPolicyDegraded()).toBe(false);
  });

  it('reports degraded when the flag row exists', async () => {
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('SELECT 1 FROM timescale_metadata')) {
        return Promise.resolve({ rows: [{ '?column?': 1 }] }) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    expect(await isCompressionPolicyDegraded()).toBe(true);
  });

  it('clears the flag once the retry succeeds', async () => {
    let degraded = true;
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('SELECT 1 FROM timescale_metadata')) {
        return Promise.resolve({ rows: degraded ? [{ '?column?': 1 }] : [] }) as never;
      }
      if (sql.includes('DELETE FROM timescale_metadata')) {
        degraded = false;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await retryDegradedCompressionPolicy();

    expect(await isCompressionPolicyDegraded()).toBe(false);
  });

  it('is a no-op when nothing is degraded', async () => {
    executeMock().mockImplementation(() => Promise.resolve({ rows: [] }) as never);

    await retryDegradedCompressionPolicy();

    const addCalled = executeMock().mock.calls.some((call) =>
      executedSql(call).includes('add_compression_policy')
    );
    expect(addCalled).toBe(false);
  });
});

describe('safeFullRefreshAggregate / safeFullRefreshAllAggregates', () => {
  beforeEach(() => {
    executeMock().mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues past a failed batch and reports it instead of silently dropping it', async () => {
    let calls = 0;
    executeMock().mockImplementation(() => {
      calls++;
      if (calls === 2) return Promise.reject(new Error('lock timeout')) as never;
      return Promise.resolve({ rows: [] }) as never;
    });

    const failed = await safeFullRefreshAggregate(
      'daily_content_engagement',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-04-01T00:00:00Z'),
      { batchDays: 30, delayBetweenBatches: 0 }
    );

    // 3 monthly batches attempted despite the middle one failing.
    expect(calls).toBe(3);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.aggregate).toBe('daily_content_engagement');
  });

  it('returns no failures when every batch succeeds', async () => {
    executeMock().mockImplementation(() => Promise.resolve({ rows: [] }) as never);

    const failed = await safeFullRefreshAggregate(
      'daily_content_engagement',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      { delayBetweenBatches: 0 }
    );

    expect(failed).toEqual([]);
  });

  it('throws naming the failed ranges when any batch failed, so a partial backfill is never mistaken for a complete one', async () => {
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('MIN(started_at)')) {
        return Promise.resolve({
          rows: [{ earliest: '2026-01-01T00:00:00Z', latest: '2026-01-05T00:00:00Z' }],
        }) as never;
      }
      if (sql.includes('CALL refresh_continuous_aggregate')) {
        return Promise.reject(new Error('lock timeout')) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await expect(safeFullRefreshAllAggregates({ delayBetweenBatches: 0 })).rejects.toThrow(
      /failed batch/
    );
  });

  it('resolves normally when nothing failed', async () => {
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('MIN(started_at)')) {
        return Promise.resolve({
          rows: [{ earliest: '2026-01-01T00:00:00Z', latest: '2026-01-05T00:00:00Z' }],
        }) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await expect(safeFullRefreshAllAggregates({ delayBetweenBatches: 0 })).resolves.toBeUndefined();
  });
});

describe('coerceRefreshBound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through a valid Date unchanged', () => {
    const fallback = new Date('2020-01-01T00:00:00Z');
    const value = new Date('2026-07-01T00:00:00Z');

    const result = coerceRefreshBound(value, fallback, 'startTime');

    expect(result.getTime()).toBe(value.getTime());
  });

  it('parses a valid ISO string (raw db.execute results return timestamptz as strings)', () => {
    const fallback = new Date('2020-01-01T00:00:00Z');

    const result = coerceRefreshBound('2026-07-01T00:00:00Z', fallback, 'startTime');

    expect(result.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls back and logs loudly on an unparseable string', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fallback = new Date('2020-01-01T00:00:00Z');

    const result = coerceRefreshBound('not-a-date', fallback, 'startTime');

    expect(result.getTime()).toBe(fallback.getTime());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = errorSpy.mock.calls[0]?.join(' ') ?? '';
    expect(message).toContain('startTime');
    expect(message).toContain('not-a-date');
  });

  it('falls back and logs loudly on an already-invalid Date', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fallback = new Date('2020-01-01T00:00:00Z');
    const invalidDate = new Date(NaN);

    const result = coerceRefreshBound(invalidDate, fallback, 'endTime');

    expect(result.getTime()).toBe(fallback.getTime());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.join(' ')).toContain('endTime');
  });

  it('falls back without logging when the value is undefined', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fallback = new Date('2020-01-01T00:00:00Z');

    const result = coerceRefreshBound(undefined, fallback, 'startTime');

    expect(result.getTime()).toBe(fallback.getTime());
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('shouldResumeBackfillInsteadOfRebuild', () => {
  it('resumes when the marker targets the current version and no aggregates are missing', () => {
    const marker = { targetVersion: 13, startedAt: '2026-07-01T00:00:00Z' };
    expect(shouldResumeBackfillInsteadOfRebuild(marker, 13, 0)).toBe(true);
  });

  it('rebuilds when there is no marker (fresh version-mismatch, not a retry)', () => {
    expect(shouldResumeBackfillInsteadOfRebuild(null, 13, 0)).toBe(false);
  });

  it('rebuilds when the marker targets an older version than the current one', () => {
    const marker = { targetVersion: 12, startedAt: '2026-07-01T00:00:00Z' };
    expect(shouldResumeBackfillInsteadOfRebuild(marker, 13, 0)).toBe(false);
  });

  it('rebuilds when an expected aggregate view is missing, even with a matching marker', () => {
    const marker = { targetVersion: 13, startedAt: '2026-07-01T00:00:00Z' };
    expect(shouldResumeBackfillInsteadOfRebuild(marker, 13, 1)).toBe(false);
  });
});

describe('getTimescaleStatus cache', () => {
  function stubCatalog() {
    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('pg_extension')) {
        return Promise.resolve({ rows: [{ installed: true }] }) as never;
      }
      if (sql.includes('compression_enabled')) {
        return Promise.resolve({ rows: [{ compression_enabled: true }] }) as never;
      }
      if (sql.includes('timescaledb_information.hypertables')) {
        return Promise.resolve({ rows: [{ is_hypertable: true }] }) as never;
      }
      if (sql.includes('continuous_aggregates')) {
        return Promise.resolve({ rows: [{ view_name: 'daily_content_engagement' }] }) as never;
      }
      if (sql.includes('timescaledb_information.chunks')) {
        return Promise.resolve({ rows: [{ count: 7 }] }) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });
  }

  beforeEach(() => {
    executeMock().mockReset();
    invalidateTimescaleStatusCache();
    stubCatalog();
  });

  afterEach(() => {
    invalidateTimescaleStatusCache();
    vi.useRealTimers();
  });

  it('runs the catalog queries once, then serves cached within the TTL', async () => {
    const first = await getTimescaleStatus();
    const callsAfterFirst = executeMock().mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(first.chunkCount).toBe(7);

    const second = await getTimescaleStatus();
    expect(second).toEqual(first);
    // No additional catalog queries while the cache is warm.
    expect(executeMock().mock.calls.length).toBe(callsAfterFirst);
  });

  it('refetches after the cache is invalidated', async () => {
    await getTimescaleStatus();
    const callsAfterFirst = executeMock().mock.calls.length;

    invalidateTimescaleStatusCache();
    await getTimescaleStatus();
    expect(executeMock().mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it('refetches after the TTL expires', async () => {
    vi.useFakeTimers();
    await getTimescaleStatus();
    const callsAfterFirst = executeMock().mock.calls.length;

    // Within the TTL: still cached.
    vi.advanceTimersByTime(4 * 60 * 1000);
    await getTimescaleStatus();
    expect(executeMock().mock.calls.length).toBe(callsAfterFirst);

    // Past the 5-minute TTL: refetches.
    vi.advanceTimersByTime(2 * 60 * 1000);
    await getTimescaleStatus();
    expect(executeMock().mock.calls.length).toBe(callsAfterFirst * 2);
  });
});
