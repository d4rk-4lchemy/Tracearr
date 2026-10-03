import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { e2eDatabaseUrl, e2eRedisPrefix, e2eRedisUrl, isShowcase } from './seed/env';

// Load root .env file (won't override existing env vars)
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // .env file is optional
}

const isCI = !!process.env.CI;

// Ensure CLAIM_CODE is available to both the test process and webServer
const CLAIM_CODE = (process.env.CLAIM_CODE ??= 'tracearr-e2e-test-claim-code');

// Isolated test-container database/redis, never the live dev stack on
// 5432/6379, and a database of its own under SHOWCASE=1 - see
// apps/e2e/seed/env.ts and README.md "Media browse seed".
const E2E_DATABASE_URL = e2eDatabaseUrl();
const E2E_REDIS_URL = e2eRedisUrl();
const E2E_REDIS_PREFIX = e2eRedisPrefix();

// E2E_BUILD=1 tests what the Docker image ships: the compiled server in
// production mode serving the built web app on one port. Run `pnpm build` first.
const useBuild = !!process.env.E2E_BUILD;
const BASE_URL = useBuild ? 'http://localhost:3000' : 'http://localhost:5173';

const serverEnv = {
  E2E_DATABASE_URL,
  DATABASE_URL: E2E_DATABASE_URL,
  REDIS_URL: E2E_REDIS_URL,
  REDIS_PREFIX: E2E_REDIS_PREFIX,
  JWT_SECRET: 'e2e-test-jwt-secret-must-be-32-chars',
  COOKIE_SECRET: 'e2e-test-cookie-secret-32-chars!',
  CORS_ORIGIN: BASE_URL,
  NODE_ENV: useBuild ? 'production' : 'development',
  LOG_LEVEL: 'warn',
  PORT: '3000',
  CLAIM_CODE,
};

export default defineConfig({
  testDir: './tests',
  globalSetup: './seed/globalSetup.ts',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: isCI ? 'on-first-retry' : 'off',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.resolve(import.meta.dirname, '.auth/user.json'),
      },
      dependencies: ['setup'],
      testIgnore: [/media-browse\.spec\.ts/, /showcase\.capture\.ts/],
    },
    {
      // Links the real signed-in owner (created by the 'setup' project) to a
      // watched title - must run after login, so it can't be part of
      // globalSetup, which runs before any project. See README.md.
      name: 'media-seed',
      testMatch: /media-browse\.setup\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'media-browse',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.resolve(import.meta.dirname, '.auth/user.json'),
      },
      testMatch: /media-browse\.spec\.ts/,
      dependencies: ['setup', 'media-seed'],
    },
    // Screenshot run, not a test: only ever invoked by the `showcase`
    // script, which sets SHOWCASE=1 and so points every default at
    // tracearr_showcase. See showcase/seed.ts and README.md. Left out of
    // normal runs so its skipped captures don't count toward --shard splits.
    ...(isShowcase()
      ? [
          {
            name: 'showcase',
            use: {
              ...devices['Desktop Chrome'],
              storageState: path.resolve(import.meta.dirname, '.auth/user.json'),
            },
            testMatch: /showcase\.capture\.ts/,
            dependencies: ['setup'],
          },
        ]
      : []),
  ],

  webServer: useBuild
    ? [
        {
          // Same database bootstrap as below; the built server reads .env the way the dev script does.
          command:
            'node seed/prepareDatabase.mjs && node --env-file-if-exists=../../.env ../server/dist/index.js',
          cwd: path.resolve(import.meta.dirname),
          port: 3000,
          reuseExistingServer: !isCI,
          timeout: 60_000,
          env: serverEnv,
        },
      ]
    : [
        {
          // globalSetup.ts runs AFTER webServer, not before - Playwright starts
          // webServer as part of plugin setup, ahead of the globalSetups array.
          // The database has to exist and be migrated before this process even
          // starts, or its own boot-time migration runner crash-loops against a
          // database that isn't there yet. See README.md "Media browse seed".
          command: 'node seed/prepareDatabase.mjs && pnpm --filter @tracearr/server dev',
          cwd: path.resolve(import.meta.dirname),
          port: 3000,
          reuseExistingServer: !isCI,
          timeout: 60_000,
          env: serverEnv,
        },
        {
          command: 'pnpm --filter @tracearr/web dev',
          cwd: path.resolve(import.meta.dirname, '../..'),
          port: 5173,
          reuseExistingServer: !isCI,
          timeout: 30_000,
        },
      ],
});
