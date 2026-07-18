import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Load root .env file (won't override existing env vars)
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // .env file is optional
}

const isCI = !!process.env.CI;

// Ensure CLAIM_CODE is available to both the test process and webServer
process.env.CLAIM_CODE ??= 'tracearr-e2e-test-claim-code';
// Playwright/pnpm may force color for child processes; drop NO_COLOR so Node
// does not emit repeated env-conflict warnings in the runner and web servers.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: 'http://localhost:5173',
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
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @tracearr/server dev',
      cwd: path.resolve(import.meta.dirname, '../..'),
      port: 3000,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: {
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          'postgresql://test:test@localhost:5433/tracearr_e2e',
        REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6380',
        JWT_SECRET: 'e2e-test-jwt-secret-must-be-32-chars',
        COOKIE_SECRET: 'e2e-test-cookie-secret-32-chars!',
        CORS_ORIGIN: 'http://localhost:5173',
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        PORT: '3000',
        BETTER_AUTH_URL: 'http://localhost:3000',
        CLAIM_CODE: process.env.CLAIM_CODE!,
      },
    },
    {
      command: 'pnpm --filter @tracearr/web exec vite --clearScreen false --logLevel error',
      cwd: path.resolve(import.meta.dirname, '../..'),
      port: 5173,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ],
});
