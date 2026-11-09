import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Read-only capture of the public visual reference. No login, form submission or user data.
await mkdir('artifacts/redesign/reference', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('https://vexoradigital.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/redesign/reference/desktop.png', fullPage: true });
  const audit = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from(root)
        .filter((k) => k.startsWith('--vx-'))
        .map((k) => [k, root.getPropertyValue(k).trim()]),
    );
    return {
      url: location.href,
      tokens,
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector('h1')).fontFamily,
      stylesheets: [...document.styleSheets].map((s) => s.href),
      fonts: [...document.fonts].map((f) => ({
        family: f.family,
        weight: f.weight,
        status: f.status,
      })),
    };
  });
  await writeFile('artifacts/redesign/reference/audit.json', JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/redesign/reference/mobile.png', fullPage: true });
} finally {
  await browser.close();
}
