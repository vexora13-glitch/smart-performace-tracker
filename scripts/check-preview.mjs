import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const target = process.argv[2];
if (
  !target ||
  !/^https:\/\/smart-performace-tracker-[a-z0-9]+-vexoranz\.vercel\.app\/?$/.test(target)
) {
  throw new Error('Pass the exact portal preview URL in the existing Vercel project.');
}
if (!process.env.VERCEL_OIDC_TOKEN)
  throw new Error('Run with vercel env run to obtain short-lived preview access.');
const origin = new URL(target).origin;
const headers = { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Origin-scoped authentication: never send the Vercel token to Supabase or another origin.
  await page.route(`${origin}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(target);
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: 'Your workspace awaits.' }).waitFor();
  assert.equal(await page.title(), 'Vexora Client Portal');
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
  const assets = await page
    .locator('script[src]')
    .evaluateAll((nodes) => nodes.map((node) => node.src));
  const bundle = await page.request.get(assets[0], { headers });
  assert((await bundle.text()).includes('ccxkaqbajugimmtsztif.supabase.co'));
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/preview-login-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/preview-login-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Live preview login, assets, new-project configuration and mobile layout verified; no page errors.',
  );
} finally {
  await browser.close();
}
