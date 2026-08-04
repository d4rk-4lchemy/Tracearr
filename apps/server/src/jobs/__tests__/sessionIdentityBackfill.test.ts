/**
 * sessionIdentityBackfill tests
 *
 * Covers the widened repair pass: sessions that already have media_id but were
 * stamped before their media row's show_media_id existed. Both the fresh-stamp
 * query and the repair query run in the same transaction and their results
 * combine into a single updated/oldest result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.js', () => ({
  db: { transaction: vi.fn() },
}));

import { db } from '../../db/client.js';
import { backfillSessionIdentityBatch } from '../sessionIdentityBackfill.js';

function mockTransaction(executeResults: Array<{ rows: unknown[] }>) {
  const execute = vi.fn();
  // Call 0 is always the GUC check; returning no rows skips the SET LOCAL call.
  execute.mockResolvedValueOnce({ rows: [] });
  for (const result of executeResults) execute.mockResolvedValueOnce(result);

  vi.mocked(db.transaction).mockImplementation((async (callback: (tx: unknown) => unknown) =>
    callback({ execute })) as never);
  return execute;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('backfillSessionIdentityBatch', () => {
  it('combines the fresh-stamp and repair pass counts and picks the oldest across both', async () => {
    mockTransaction([
      {
        rows: [
          { started_at: '2024-01-05T00:00:00.000Z' },
          { started_at: '2024-01-01T00:00:00.000Z' },
        ],
      },
      { rows: [{ started_at: '2023-12-01T00:00:00.000Z' }] },
    ]);

    const result = await backfillSessionIdentityBatch(5000);

    expect(result.updated).toBe(3);
    expect(result.oldest).toEqual(new Date('2023-12-01T00:00:00.000Z'));
  });

  it('runs both passes even when the fresh-stamp pass finds nothing to repair', async () => {
    const execute = mockTransaction([
      { rows: [] },
      { rows: [{ started_at: '2024-02-01T00:00:00.000Z' }] },
    ]);

    const result = await backfillSessionIdentityBatch(5000);

    expect(result.updated).toBe(1);
    expect(result.oldest).toEqual(new Date('2024-02-01T00:00:00.000Z'));
    // GUC check + fresh-stamp query + repair query, no SET LOCAL since the GUC check found nothing.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns zero updated and a null oldest when neither pass finds anything', async () => {
    mockTransaction([{ rows: [] }, { rows: [] }]);

    const result = await backfillSessionIdentityBatch(5000);

    expect(result).toEqual({ updated: 0, oldest: null });
  });
});
