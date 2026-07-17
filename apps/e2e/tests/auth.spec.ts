import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    // Clear any auth state
    await page.context().clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/');

    await expect(page).toHaveURL(/\/login/);
  });

  test('login page shows sign in form', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/login');

    await page.waitForSelector('form');
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  });

  test('can log in with local credentials', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/login');
    await page.waitForSelector('form');

    await page.locator('#identifier').fill('e2e@tracearr.test');
    await page.locator('#password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });
});
