/**
 * Environment discovery + runtime module loading shared by the admin scripts
 * (cli.ts, reset-password.ts).
 *
 * Scripts ship as raw TypeScript inside the Docker image - there is no build
 * step for scripts/, so they run directly via `node` (production, against
 * the compiled dist/ output) or `tsx` (dev, against src/ directly). This
 * module resolves which one is available and dynamically imports the
 * runtime pieces scripts need from it, so a single implementation works in
 * both environments without a Docker copy-step change every time a script
 * touches a new module. KISS.
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables if DATABASE_URL is not already set.
 * in docker, we may have env variables set directly or via a .env file
 * in proxmox lxc, we rely on a .env file at /data/tracearr/.env
 * there may be other methods we need to support in the future
 */
export function loadEnv(): void {
  if (process.env.DATABASE_URL) return;

  const envPaths = [
    resolve(import.meta.dirname, '../../../../.env'), // docker and dev
    '/data/tracearr/.env', // proxmox lxc
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
      if (process.env.DATABASE_URL) return;
    }
  }

  console.error('ERROR: DATABASE_URL environment variable not found.\n');
  console.error('Tried loading from:');
  for (const envPath of envPaths) {
    console.error(`  • ${envPath}`);
  }
  console.error('\nPlease ensure DATABASE_URL is set or one of these files exists.\n');
  process.exit(1);
}

/**
 * Determine if we're in development (src files) or production (dist files).
 * this is just so we dont have to build the project for testing the scripts
 * or add extra copy steps to the Dockerfile. KISS.
 */
function basePath(): string {
  const srcPath = resolve(import.meta.dirname, '../../src/db/client.ts');
  return existsSync(srcPath) ? '../../src' : '../../dist';
}

/**
 * Loads the DB/auth runtime pieces the admin commands need. Must be called
 * after (or via) loadEnv() so DATABASE_URL/REDIS_URL are populated before
 * the modules that read them at import time are loaded.
 */
export async function loadRuntime() {
  loadEnv();
  const base = basePath();

  const [dbModule, schema, passwordModule, settingsModule, redisModule] = await Promise.all([
    import(`${base}/db/client.js`),
    import(`${base}/db/schema.js`),
    import(`${base}/utils/password.js`),
    import(`${base}/services/settings.js`),
    import(`${base}/lib/redisShared.js`),
  ]);

  return {
    db: dbModule.db,
    closeDatabase: dbModule.closeDatabase,
    users: schema.users,
    authAccounts: schema.authAccounts,
    authSessions: schema.authSessions,
    hashPassword: passwordModule.hashPassword,
    setSetting: settingsModule.setSetting,
    getSetting: settingsModule.getSetting,
    getRedis: redisModule.getRedis,
    closeRedis: redisModule.closeRedis,
  };
}
