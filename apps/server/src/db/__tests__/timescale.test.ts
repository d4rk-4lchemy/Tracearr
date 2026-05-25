import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../client.js';
import { withSessionsCompressionPaused } from '../timescale.js';

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

  it('logs a recovery command if restoring the policy fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    executeMock().mockImplementation((q: unknown) => {
      const sql = executedSql([q]);
      if (sql.includes('add_compression_policy')) {
        return Promise.reject(new Error('connection lost')) as never;
      }
      return Promise.resolve({ rows: [] }) as never;
    });

    await withSessionsCompressionPaused(async () => 'ok');

    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(msg).toMatch(/add_compression_policy/);
  });
});
