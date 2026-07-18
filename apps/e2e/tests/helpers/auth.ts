import { expect, type Page } from '@playwright/test';

/**
 * The backend opens its HTTP port before DB/Redis-dependent services finish
 * booting. During that window the frontend shows a startup screen instead of
 * the login/signup form and auto-refreshes once the API becomes ready.
 */
export async function waitForAuthForm(page: Page, timeout = 90_000): Promise<void> {
  await expect(async () => {
    await expect(page.locator('form')).toBeVisible();
  }).toPass({
    timeout,
    intervals: [1_000, 2_000, 5_000],
  });
}
