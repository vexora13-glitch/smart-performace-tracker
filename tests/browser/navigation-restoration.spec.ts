import { expect, test } from '@playwright/test';
import { fixture } from '../helpers/portal-fixture';

test('staff primary navigation uses original pages and authentic logo within the navy shell', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  const { errors } = await fixture(page, 'admin');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button')).toHaveText(['Dashboard', 'Clients', /Messages/, 'Documents', 'Videos', 'VexBot']);
  await expect(page.locator('.sidebar .brand-logo')).toHaveAttribute('src', '/brand/vexora-logo.png');
  await expect.poll(() => page.locator('.sidebar .brand-logo').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Welcome back, Allan.' })).toBeVisible();
  await nav.getByRole('button', { name: 'Clients', exact: true }).click();
  await expect(page.getByLabel('Search clients')).toBeVisible();
  await nav.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messages.', exact: true })).toBeVisible();
  for (const name of ['Documents', 'Videos']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Manage client', exact: true })).toBeVisible();
    await expect(page.locator('.file-tabs').getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await nav.getByRole('button', { name: 'VexBot', exact: true }).click();
  await expect(page.getByTestId('vexbot-mfa')).toBeVisible();
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Allan.' })).toBeVisible();
  for (const button of await nav.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/navigation-restoration/sidebar-desktop.png' });
  await page.locator('.sidebar').screenshot({ path: 'artifacts/navigation-restoration/sidebar-detail.png' });
  expect(errors).toEqual([]);
});

test('customer navigation conceals staff tools, retains workspace features and opens the real assistant', async ({ page }) => {
  const { errors } = await fixture(page, 'client');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button')).toHaveText(['Dashboard', /Messages/, 'Documents', 'Videos', 'VexBot']);
  await expect(page.getByRole('heading', { name: 'Latest updates', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'VexBot', exact: true }).click();
  await expect(page.getByTestId('vexbot-input')).toBeFocused();
  await expect(page.getByTestId('vexbot-admin')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Videos', exact: true }).click();
  await page.getByRole('link', { name: 'Vexora portal home', exact: true }).click();
  await expect(page.locator('.file-tabs').getByRole('button', { name: 'All files', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Latest updates', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar .brand-logo')).toBeVisible();
  await page.screenshot({ path: 'artifacts/navigation-restoration/mobile-home.png' });
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobile.getByRole('button')).toHaveText(['Dashboard', /Messages/, 'Documents', 'Videos', 'VexBot']);
  await page.screenshot({ path: 'artifacts/navigation-restoration/sidebar-mobile.png' });
  await mobile.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your workspace' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
