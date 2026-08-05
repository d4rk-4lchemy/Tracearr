import { describe, expect, it, vi } from 'vitest';

const { migrateMock } = vi.hoisted(() => ({ migrateMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: migrateMock }));

import { createRawPgClient, db, repairLegacyForkMigrationLedger, runMigrations } from '../client.js';

function createMigrationLedgerExecutor(
  rows: Array<{ ledger?: string | null; repaired?: boolean }>
) {
  return {
    execute: vi.fn().mockImplementation(async () => ({ rows: [rows.shift() ?? {}] })),
  };
}

describe('runMigrations', () => {
  it('runs the upstream history before the fork overlay in a separate ledger', async () => {
    const executeSpy = vi
      .spyOn(db, 'execute')
      .mockResolvedValue({ rows: [{ ledger: null }] } as never);

    try {
      await runMigrations({ upstream: '/migrations/upstream', fork: '/migrations/fork' });
    } finally {
      executeSpy.mockRestore();
    }

    expect(migrateMock).toHaveBeenCalledTimes(2);
    expect(migrateMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ migrationsFolder: '/migrations/upstream' })
    );
    expect(migrateMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        migrationsFolder: '/migrations/fork',
        migrationsSchema: 'tracearr_fork',
        migrationsTable: '__drizzle_migrations',
      })
    );
  });
});

describe('repairLegacyForkMigrationLedger', () => {
  it('does nothing when the main Drizzle ledger has not been created yet', async () => {
    const executor = createMigrationLedgerExecutor([{ ledger: null }]);

    await expect(repairLegacyForkMigrationLedger(executor as never)).resolves.toBe(false);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('reports a repair only when the guarded legacy row is removed', async () => {
    const executor = createMigrationLedgerExecutor([
      { ledger: 'drizzle.__drizzle_migrations' },
      { repaired: true },
    ]);

    await expect(repairLegacyForkMigrationLedger(executor as never)).resolves.toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('leaves a database with media already present untouched', async () => {
    const executor = createMigrationLedgerExecutor([
      { ledger: 'drizzle.__drizzle_migrations' },
      { repaired: false },
    ]);

    await expect(repairLegacyForkMigrationLedger(executor as never)).resolves.toBe(false);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });
});

describe('createRawPgClient', () => {
  it('attaches an error listener so a severed connection cannot crash the process', () => {
    const client = createRawPgClient('test-context');
    expect(client.listenerCount('error')).toBe(1);
    expect(client.database).toBe('tracearr_test'); // from setup.ts DATABASE_URL

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // With no listener this emit would throw (unhandled 'error' event).
    client.emit('error', new Error('Connection terminated unexpectedly'));
    expect(errSpy).toHaveBeenCalledWith(
      '[DB Client Error] (test-context)',
      'Connection terminated unexpectedly'
    );
    errSpy.mockRestore();
  });
});
