import { test, expect, type Page } from '@playwright/test';
import path from 'path';

test.use({ storageState: path.resolve(import.meta.dirname, '../.auth/user.json') });

// Most pages carry an sr-only h1 and no visible title, so headings are checked as attached.
test.describe('Page Navigation', () => {
  test('can navigate to history page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeAttached();
  });

  test('can navigate to map page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });

  test('can navigate to users page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeAttached();
    for (const name of ['Role', 'Sign-in', 'Status']) {
      await expect(page.getByRole('columnheader', { name })).toBeVisible();
    }
  });

  test('can navigate to automations page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Automations' }).click();
    await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeAttached();
    await expect(page).toHaveURL(/\/automations$/);
  });

  test('can navigate to violations through the automations tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Automations' }).click();
    await page
      .getByRole('navigation', { name: 'Automations' })
      .getByRole('link', { name: /^Violations/ })
      .click();
    await expect(page).toHaveURL(/\/violations$/);
    await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeAttached();
  });

  test('can navigate to settings page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/general\/appearance$/);
  });
});

test.describe('Stats Navigation', () => {
  const statsTabs = (page: Page) => page.getByRole('navigation', { name: 'Stats' });

  test('opens on the activity tab', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page).toHaveURL(/\/stats\/activity$/);
    await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeAttached();
  });

  test('can navigate to the people tab', async ({ page }) => {
    await page.goto('/stats/activity');
    await statsTabs(page).getByRole('link', { name: 'People' }).click();
    await expect(page).toHaveURL(/\/stats\/people/);
    await expect(
      page.getByText('Active people').or(page.getByText('No activity yet'))
    ).toBeVisible();
  });

  test('can navigate to devices and bandwidth tabs', async ({ page }) => {
    await page.goto('/stats/activity');
    await statsTabs(page).getByRole('link', { name: 'Devices' }).click();
    await expect(page).toHaveURL(/\/stats\/devices/);
    await statsTabs(page).getByRole('link', { name: 'Bandwidth' }).click();
    await expect(page).toHaveURL(/\/stats\/bandwidth/);
  });

  test('keeps the time range when switching tabs', async ({ page }) => {
    await page.goto('/stats/activity?period=week');
    await statsTabs(page).getByRole('link', { name: 'Bandwidth' }).click();
    await expect(page).toHaveURL(/period=week/);
  });
});

test.describe('Library Navigation', () => {
  const libraryTabs = (page: Page) => page.getByRole('navigation', { name: 'Library' });

  test('can navigate to the library overview page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeAttached();
  });

  test('can navigate to the browse page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Browse' }).click();
    await expect(page).toHaveURL(/\/media\/browse$/);
  });

  for (const tab of ['Genres', 'Quality', 'Storage', 'Watch']) {
    test(`can navigate to the ${tab.toLowerCase()} tab`, async ({ page }) => {
      await page.goto('/library');
      await libraryTabs(page).getByRole('link', { name: tab }).click();
      await expect(page).toHaveURL(new RegExp(`/library/${tab.toLowerCase()}`));
    });
  }

  test('redirects the old media url to the library', async ({ page }) => {
    await page.goto('/media');
    await expect(page).toHaveURL(/\/library$/);
  });
});
