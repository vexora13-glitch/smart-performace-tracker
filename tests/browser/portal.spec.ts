import { expect, test } from '@playwright/test';
import { fixture, ADMIN, CLIENT } from '../helpers/portal-fixture';

test('login is responsive, hides passwords and handles rejected credentials', async ({ page }) => {
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, json: { message: 'Invalid login credentials' } }),
  );
  await page.goto('/');
  await expect(page).toHaveTitle('Vexora Client Portal');
  await page.getByLabel('Email address').fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword123!');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign in');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/login-mobile.png', fullPage: true });
});
test('admin manages clients, publishes an update and uploads a private document', async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  await expect(page.getByRole('heading', { name: 'Welcome back, Allan.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/admin-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company', { exact: true }).fill('New Studio');
  await dialog.getByLabel('Contact name').fill('New Contact');
  await dialog.getByLabel('Email address').fill('new@example.test');
  await dialog.getByLabel('Initial password').fill('SecurePassword123!');
  const request = page.waitForRequest('**/api/clients');
  await dialog.getByRole('button', { name: 'Create client & workspace' }).click();
  expect((await request).postDataJSON().company).toBe('New Studio');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  await page.getByRole('button', { name: 'Publish update', exact: true }).click();
  await page.getByLabel('Update title').fill('Ready for review');
  await page.getByLabel('Message', { exact: true }).fill('Your launch documents are ready.');
  await page.getByRole('button', { name: 'Publish to client' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible();
  await page.getByLabel('Upload client file').setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF test'),
  });
  await expect(page.getByText('brief.pdf', { exact: true })).toBeVisible();
  expect(state.portal_files[0].workspace_id).toBe(CLIENT);
  expect(state.portal_announcements[0].author_id).toBe(ADMIN);
  expect(errors).toEqual([]);
});
test('admin reads, replies, archives and reopens a conversation', async ({ page }) => {
  const { state, errors } = await fixture(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Messages/ })
    .click();
  await page.getByRole('button', { name: /Website launch Acme Studio/ }).click();
  await expect(page.getByText('When can we review the launch?')).toBeVisible();
  await page.getByLabel('Your reply').fill('Let’s review tomorrow.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Let’s review tomorrow.')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('This conversation is archived.', { exact: false })).toBeVisible();
  expect(state.portal_conversations[0].archived_at).toBeTruthy();
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.getByLabel('Your reply')).toBeVisible();
  expect(errors).toEqual([]);
});
test('client has its own workspace, sends questions, and signs out', async ({ page }) => {
  const { state, errors } = await fixture(page, 'client');
  await expect(page.getByRole('heading', { name: 'Acme Studio.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage client' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Clients' })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Upload client file')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open messages' }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).first().click();
  await page.getByLabel('Subject').fill('A new idea');
  await page.getByLabel('Your message', { exact: true }).fill('Can we add a landing page?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Can we add a landing page?', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Message sent');
  expect(state.portal_conversations[0].workspace_id).toBe(CLIENT);
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/client-messages-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace awaits.' })).toBeVisible();
  expect(errors).toEqual([]);
});
