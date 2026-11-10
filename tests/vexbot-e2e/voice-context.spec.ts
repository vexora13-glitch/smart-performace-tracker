import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('selected portal message and natural open-file intent use authorised context', async ({
  page,
  isMobile,
}) => {
  const seed = JSON.parse(readFileSync('artifacts/vexbot-seed.json', 'utf8'));
  await page.goto('/');
  await page.locator('input[name=email]').fill(seed.alice.email);
  await page.locator('input[name=password]').fill(seed.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('button', { name: 'Messages', exact: true }).first().click();
  await page
    .getByRole('button', { name: /Launch timing/ })
    .first()
    .click();
  await page
    .locator('.message')
    .filter({ hasText: 'Can we confirm the launch workshop time?' })
    .getByRole('button', { name: 'Ask Vexbot about this message' })
    .click();
  await expect(page.getByTestId('vexbot-input')).toHaveValue('Can you read this message?');
  await page.getByTestId('vexbot-send').click();
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText(
    'Can we confirm the launch workshop time?',
  );
  await page.screenshot({
    path: `artifacts/voice-upgrade/message-${test.info().project.name}.png`,
  });
  await page.getByRole('button', { name: 'Close Vexbot', exact: true }).click();
  await page
    .getByRole('button', { name: 'Sign out', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.locator('input[name=email]').fill(seed.tess.email);
  await page.locator('input[name=password]').fill(seed.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('vexbot-launcher').click();
  await page.getByTestId('vexbot-input').fill('Open pike point.pdf');
  await page.getByTestId('vexbot-send').click();
  await expect(
    page.getByRole('dialog', { name: 'Preview pike point.pdf', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Preview pike point.pdf', exact: true }).locator('canvas'),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Preview pike point.pdf', exact: true }).locator('details p'),
  ).toContainText('2.4 km');
  await page.screenshot({
    path: `artifacts/voice-upgrade/open-file-${test.info().project.name}.png`,
  });
});
