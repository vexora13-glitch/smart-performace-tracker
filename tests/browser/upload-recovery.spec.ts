import { expect, test } from '@playwright/test';
import { fixture, CLIENT } from '../helpers/portal-fixture';

for (const committed of [true, false]) {
  test(`lost metadata response ${committed ? 'preserves an already registered object' : 'cleans only the new unregistered object'}`, async ({ page }) => {
    const { state, errors } = await fixture(page, 'admin');
    let removed = 0;
    let idempotent = false;
    await page.route('**/storage/v1/object/portal-private', route => {
      if (route.request().method() === 'DELETE') removed++;
      return route.fulfill({ json: [] });
    });
    await page.route('**/rest/v1/portal_files?**', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      idempotent = route.request().headers().prefer.includes('resolution=ignore-duplicates');
      const row = route.request().postDataJSON();
      if (committed && !state.portal_files.some(file => file.path === row.path)) state.portal_files.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row });
      return route.fulfill({ status: 503, json: { message: 'Synthetic lost metadata response' } });
    });
    await page.locator('.client-row').filter({ hasText: 'Acme Studio' }).click();
    await page.getByLabel('Upload client file').setInputFiles({ name: 'Recovery.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic transport recovery fixture.') });
    await expect(page.getByRole('alert')).toContainText('Synthetic lost metadata response');
    expect(idempotent).toBe(true);
    expect(removed).toBe(committed ? 0 : 1);
    if (committed) {
      await page.getByRole('button', { name: 'Refresh portal' }).click();
      await expect(page.getByText('Recovery.txt', { exact: true })).toBeVisible();
      expect(state.portal_files[0].workspace_id).toBe(CLIENT);
    }
    expect(errors).toEqual([]);
  });
}
