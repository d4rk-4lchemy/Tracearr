/**
 * Runs template migrations in a separate process.
 *
 * Importing the application DB singleton from Vitest globalSetup contaminates
 * the module graph inherited by fork workers before their per-worker database
 * environment is available. Keeping this small entry point out-of-process
 * prevents that shared base-database pool from leaking into test modules.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, closeDatabase } from '../db/client.js';
import { initTimescaleDB } from '../db/timescale.js';

const dbDir = resolve(dirname(fileURLToPath(import.meta.url)), '../db');

try {
  await runMigrations({
    upstream: resolve(dbDir, 'migrations'),
    fork: resolve(dbDir, 'fork-migrations'),
  });
  await initTimescaleDB();
} finally {
  await closeDatabase();
}
