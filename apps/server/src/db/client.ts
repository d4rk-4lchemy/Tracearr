/**
 * Database client and connection pool
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

function createPool(): pg.Pool {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 50,
    idleTimeoutMillis: 20000, // Close idle connections after 20s
    connectionTimeoutMillis: 5000, // Max wait to acquire a connection from the pool (not running query timeout)
    maxUses: 7500, // Max queries per connection before refresh (prevents memory leaks)
    allowExitOnIdle: false, // Keep pool alive during idle periods
    // Disable JIT — counterproductive for OLTP queries against TimescaleDB hypertables.
    options: '-c jit=off',
  });

  // Log pool errors for debugging
  p.on('error', (err) => {
    console.error('[DB Pool Error]', err.message);
  });

  return p;
}

/**
 * Dedicated non-pooled client for sessions the pool can't hand out (advisory
 * locks, ALTER EXTENSION, migrations). Always carries an error listener: a
 * severed connection (postgres crash/restart) emits 'error' on an idle client,
 * and an unhandled 'error' event kills the process. A query in flight when the
 * connection drops rejects to its caller instead, listener or not.
 * `context` names the owner in the log line.
 */
export function createRawPgClient(context: string): pg.Client {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  client.on('error', (err) => {
    console.error(`[DB Client Error] (${context})`, err.message);
  });
  return client;
}

let pool = createPool();
// Exported as `let` so recreatePool() can reassign it. ESM live bindings ensure
// all modules importing `db` automatically see the new instance after reassignment.
export let db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

/**
 * Destroy the current pool and create a fresh one.
 * Used after ALTER EXTENSION updates so new connections pick up the updated extension,
 * and during restore to re-establish connections after DB replacement.
 *
 * Safe to call even if the pool was already closed via closeDatabase().
 */
export async function recreatePool(): Promise<void> {
  try {
    await pool.end();
  } catch {
    // Pool may already be closed (e.g. closeDatabase() was called first)
  }
  pool = createPool();
  db = drizzle(pool, { schema });
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export async function checkDatabaseConnection(): Promise<boolean> {
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export interface MigrationFolders {
  upstream: string;
  fork: string;
}

const FORK_MIGRATIONS_SCHEMA = 'tracearr_fork';
const FORK_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Before the fork ledger existed, this Dispatcharr migration lived in the
 * upstream Drizzle ledger. Its timestamp is newer than upstream's media
 * migration, so leaving it there causes Drizzle to skip the CREATE TABLE
 * migration on upgrades from the old fork.
 */
const LEGACY_DISPATCHARR_MAIN_LEDGER_MIGRATION = {
  createdAt: 1_784_448_000_000,
  hash: '5bfdbcde0cfc9cf1fb3865ede5d15eed65270be8e486d03a309365fcb8bb4534',
} as const;

type MigrationLedgerExecutor = Pick<NodePgDatabase<typeof schema>, 'execute'>;

/**
 * Remove the one stale legacy-fork cursor which otherwise hides upstream's
 * media migrations. The overlay re-applies its schema idempotently in its own
 * ledger after upstream migrations complete.
 */
export async function repairLegacyForkMigrationLedger(
  migrationDb: MigrationLedgerExecutor = db
): Promise<boolean> {
  const ledger = await migrationDb.execute(sql<{ ledger: string | null }>`
    SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger
  `);

  if (!(ledger.rows as Array<{ ledger: string | null }>)[0]?.ledger) return false;

  const repaired = await migrationDb.execute(sql<{ repaired: boolean }>`
    WITH removed AS (
      DELETE FROM drizzle.__drizzle_migrations
      WHERE created_at = ${LEGACY_DISPATCHARR_MAIN_LEDGER_MIGRATION.createdAt}
        AND hash = ${LEGACY_DISPATCHARR_MAIN_LEDGER_MIGRATION.hash}
        AND to_regclass('public.media') IS NULL
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM removed) AS repaired
  `);

  return (repaired.rows as Array<{ repaired: boolean }>)[0]?.repaired ?? false;
}

/**
 * Apply the upstream Tracearr history and the fork-owned Dispatcharr overlay.
 *
 * The ledgers must remain separate: Drizzle decides whether to run a migration
 * from the latest timestamp in one ledger, while the upstream and fork
 * histories evolve independently.
 */
export async function runMigrations(folders: MigrationFolders): Promise<void> {
  if (await repairLegacyForkMigrationLedger()) {
    console.info(
      '[Database] Removed the stale pre-fork-ledger Dispatcharr migration cursor before upstream migrations.'
    );
  }
  await migrate(db, { migrationsFolder: folders.upstream });
  await migrate(db, {
    migrationsFolder: folders.fork,
    migrationsSchema: FORK_MIGRATIONS_SCHEMA,
    migrationsTable: FORK_MIGRATIONS_TABLE,
  });
}
