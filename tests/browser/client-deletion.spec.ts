import { expect, test, type Page } from '@playwright/test';
import { fixture, CLIENT } from '../helpers/portal-fixture';

const SECOND = '55555555-5555-4555-8555-555555555555';
const THIRD = '66666666-6666-4666-8666-666666666666';
async function openClients(page: Page) {
  const context = await fixture(page);
  context.state.portal_clients.push(
    {
      id: SECOND,
      company: 'Beta Studio',
      email: 'bob@example.test',
      created_at: '2026-11-01T09:00:00Z',
    },
    {
      id: THIRD,
      company: 'Gamma',
      email: 'gamma@example.test',
      created_at: '2026-11-01T09:00:00Z',
    },
  );
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Clients', exact: true })
    .click();
  await expect(page.getByRole('checkbox', { name: 'Select Gamma' })).toBeVisible();
  return context;
}

test('single client deletion warns, requires acknowledgement and supports cancellation', async ({
  page,
}) => {
  const { state, errors } = await openClients(page);
  const requests: object[] = [];
  await page.route('**/api/clients', async (route) => {
    requests.push(route.request().postDataJSON());
    expect(route.request().method()).toBe('DELETE');
    state.portal_clients = state.portal_clients.filter((client) => client.id !== CLIENT);
    await route.fulfill({ json: { deleted: [CLIENT], failed: [] } });
  });
  await page.getByRole('button', { name: 'Delete Acme Studio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete client?' });
  await expect(dialog).toContainText('This information cannot be recovered');
  await expect(dialog).toContainText('until they are registered again');
  await expect(dialog.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toEqual([]);
  await expect(page.getByRole('button', { name: 'Delete Acme Studio', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Acme Studio', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'I understand this cannot be undone.' }).check();
  await dialog.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toEqual([{ ids: [CLIENT], confirm: 'DELETE' }]);
  await expect(page.getByRole('button', { name: 'Delete Acme Studio', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('status').filter({ hasText: '1 client permanently deleted' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Beta Studio', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('select all follows the search, supports deselection and deletes only selected clients', async ({
  page,
}) => {
  const { state, errors } = await openClients(page);
  await page.getByLabel('Search clients').fill('Studio');
  await page.getByRole('checkbox', { name: 'Select all matching clients' }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Select Acme Studio', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Select Beta Studio', exact: true }),
  ).toBeChecked();
  await page.getByLabel('Search clients').fill('');
  await expect(page.getByRole('checkbox', { name: 'Select Gamma' })).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Select all clients', exact: true }),
  ).toHaveJSProperty('indeterminate', true);
  await page.getByRole('checkbox', { name: 'Select all clients', exact: true }).check();
  await expect(page.getByRole('status').filter({ hasText: '3 selected' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all clients', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Delete selected' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Acme Studio', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Beta Studio', exact: true }).check();
  await page.route('**/api/clients', async (route) => {
    expect(route.request().postDataJSON().ids).toEqual([CLIENT, SECOND]);
    state.portal_clients = state.portal_clients.filter((client) => client.id === THIRD);
    await route.fulfill({ json: { deleted: [CLIENT, SECOND], failed: [] } });
  });
  await page.getByRole('button', { name: 'Delete selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 2 clients?' });
  await expect(dialog).not.toContainText('Gamma');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'Select Gamma' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete selected' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('partial failures stay in the dialog and retries do not resubmit successful deletions', async ({
  page,
}) => {
  const { state, errors } = await openClients(page);
  await page.getByRole('checkbox', { name: 'Select Acme Studio', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Beta Studio', exact: true }).check();
  let attempts = 0;
  await page.route('**/api/clients', async (route) => {
    const ids = route.request().postDataJSON().ids;
    if (++attempts === 1) {
      state.portal_clients = state.portal_clients.filter((client) => client.id !== CLIENT);
      await route.fulfill({ json: { deleted: [CLIENT], failed: [SECOND] } });
    } else {
      expect(ids).toEqual([SECOND]);
      state.portal_clients = state.portal_clients.filter((client) => client.id !== SECOND);
      await route.fulfill({ json: { deleted: [SECOND], failed: [] } });
    }
  });
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Permanently delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete client?' });
  await expect(dialog.getByRole('alert')).toContainText('Their access remains revoked');
  await expect(dialog).toContainText('Beta Studio');
  await expect(dialog).not.toContainText('Acme Studio');
  await dialog.getByRole('button', { name: 'Retry deletion' }).click();
  await expect(dialog).toBeHidden();
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test('delete controls fit mobile and are absent from client accounts', async ({ page }) => {
  await openClients(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole('button', { name: 'Delete Acme Studio', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Delete Acme Studio', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page
    .getByRole('dialog', { name: 'Your workspace' })
    .getByRole('button', { name: 'Dashboard' })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await fixture(page, 'client');
  await expect(
    page.getByRole('button', { name: /Delete selected|Delete Acme Studio/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Select.*client/ })).toHaveCount(0);
});
