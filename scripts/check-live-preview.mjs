import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const target = process.argv[2];
if (
  !target ||
  !/^https:\/\/smart-performace-tracker-[a-z0-9]+-vexoranz\.vercel\.app\/?$/.test(target)
)
  throw new Error('Expected portal preview URL.');
if (!process.env.VERCEL_OIDC_TOKEN || !process.env.PORTAL_ADMIN_INITIAL_PASSWORD)
  throw new Error('Preview access and local administrator credential required.');
const origin = new URL(target).origin;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
await context.route(`${origin}/**`, (route) =>
  route.continue({
    headers: {
      ...route.request().headers(),
      'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN,
    },
  }),
);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const run = Date.now();
const company = `Browser Validation ${run}`;
const email = `portal-browser-${run}@example.com`;
const password = `Vx9!${randomBytes(22).toString('base64url')}`;
// Keep only local credentials, without screenshots or logs containing password fields.
writeFileSync('artifacts/browser-account.local', JSON.stringify({ email, password, company }));
const passed = [];
async function step(name, action) {
  await action();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function login(email, password) {
  await page.goto(target);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
}
try {
  await step('deployed administrator login', async () => {
    await login('allan@vexoradigital.com', process.env.PORTAL_ADMIN_INITIAL_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Welcome back, Allan.' })).toBeVisible();
  });
  await step('deployed administrator creates client through Vercel API', async () => {
    await page.getByRole('button', { name: 'Add client', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Company', { exact: true }).fill(company);
    await dialog.getByLabel('Contact name').fill('Browser Validation');
    await dialog.getByLabel('Email address').fill(email);
    await dialog.getByLabel('Initial password').fill(password);
    await dialog.getByRole('button', { name: 'Create client & workspace' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20000 });
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Clients', exact: true })
      .click();
    await page.getByLabel('Search clients').fill(company);
    await page.getByRole('button', { name: new RegExp(company) }).click();
  });
  await step('deployed document upload and update publication', async () => {
    await page
      .getByLabel('Upload client file')
      .setInputFiles({
        name: 'browser-validation.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Private browser workflow validation'),
      });
    await expect(page.getByText('browser-validation.txt', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('button', { name: 'Publish update', exact: true }).click();
    await page.getByLabel('Update title').fill('Browser workflow verified');
    await page
      .getByLabel('Message', { exact: true })
      .fill('This update was saved to the hosted portal database.');
    await page.getByRole('button', { name: 'Publish to client' }).click();
    await expect(page.getByRole('heading', { name: 'Browser workflow verified' })).toBeVisible();
  });
  await step('real playable WebM upload', async () => {
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#7561ce';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = 'white';
      ctx.font = '24px sans-serif';
      ctx.fillText('Vexora validation', 48, 95);
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      const done = new Promise((resolve) => {
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(
            Array.from(
              new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()),
            ),
          );
        };
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 600));
      recorder.stop();
      return done;
    });
    assert(bytes.length > 100);
    await page
      .getByLabel('Upload client file')
      .setInputFiles({
        name: 'browser-validation.webm',
        mimeType: 'video/webm',
        buffer: Buffer.from(bytes),
      });
    await expect(page.getByText('browser-validation.webm', { exact: true })).toBeVisible({
      timeout: 20000,
    });
  });
  await step(
    'client initial-password login, document download and private video playback',
    async () => {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await login(email, password);
      await expect(page.getByRole('heading', { name: `${company}.` })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Manage client' })).toHaveCount(0);
      const downloadPromise = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Download browser-validation.txt', exact: true })
        .click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'browser-validation.txt');
      const file = await download.path();
      assert.equal(readFileSync(file, 'utf8'), 'Private browser workflow validation');
      await page.getByRole('button', { name: 'Play browser-validation.webm', exact: true }).click();
      const video = page.locator('video');
      await video.waitFor();
      await expect
        .poll(() => video.evaluate((v) => v.readyState), { timeout: 20000 })
        .toBeGreaterThanOrEqual(2);
      await video.evaluate(async (v) => {
        v.muted = true;
        await v.play();
      });
      await page.getByRole('button', { name: 'Close video' }).click();
      await expect(page.getByRole('heading', { name: 'Browser workflow verified' })).toBeVisible();
    },
  );
  await step('deployed client question persists and shows email pending', async () => {
    await page.getByRole('button', { name: 'Open messages' }).click();
    await page.getByRole('button', { name: 'New conversation', exact: true }).first().click();
    await page.getByLabel('Subject').fill('Browser validation question');
    await page
      .getByLabel('Your message', { exact: true })
      .fill('Can you confirm this reached the administrator?');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      page.getByText('Can you confirm this reached the administrator?', { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('status')).toContainText('Message sent', { timeout: 20000 });
  });
  await step('deployed administrator replies and archives conversation', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login('allan@vexoradigital.com', process.env.PORTAL_ADMIN_INITIAL_PASSWORD);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /Messages/ })
      .click();
    await page.getByRole('button', { name: /Browser validation question/ }).click();
    await page.getByLabel('Your reply').fill('Confirmed through the deployed application.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      page.getByText('Confirmed through the deployed application.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('This conversation is archived.', { exact: false })).toBeVisible();
  });
  await step('client reads administrator reply and archived history on mobile', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(email, password);
    await page.getByRole('button', { name: 'Open messages' }).click();
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.getByRole('button', { name: /Browser validation question/ }).click();
    await expect(
      page.getByText('Confirmed through the deployed application.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Your reply')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'artifacts/live-preview-client-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    'artifacts/live-preview-results.json',
    JSON.stringify({ target, passed, retainedValidationEmail: email }, null, 2),
  );
  console.log(
    'Full deployed browser flow passed. Validation records retained; no production deployment changes.',
  );
} finally {
  await browser.close();
}
// Disable validation logins after use without deleting data or objects.
const service = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const emails = [
  email,
  ...JSON.parse(readFileSync('artifacts/live-accounts.local', 'utf8')).accounts.map((a) => a.email),
];
const ids =
  (await service.from('portal_clients').select('id').in('email', emails)).data?.map(
    (row) => row.id,
  ) || [];
const result = await service
  .from('portal_profiles')
  .update({ active: false, sessions_invalid_before: Math.floor(Date.now() / 1000) })
  .in('id', ids);
if (result.error) throw new Error('Could not disable validation accounts');
console.log(`Disabled ${ids.length} validation accounts; retained their data for review.`);
