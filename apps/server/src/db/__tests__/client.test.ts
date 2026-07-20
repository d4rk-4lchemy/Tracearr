import { describe, expect, it, vi } from 'vitest';

const { migrateMock } = vi.hoisted(() => ({ migrateMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: migrateMock }));

import { runMigrations } from '../client.js';

describe('runMigrations', () => {
  it('runs the upstream history before the fork overlay in a separate ledger', async () => {
    await runMigrations({ upstream: '/migrations/upstream', fork: '/migrations/fork' });

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
