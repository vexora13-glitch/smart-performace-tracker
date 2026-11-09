import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CLIENT, fixture } from '../helpers/portal-fixture';

const video = {
  id: '55555555-5555-4555-8555-555555555555', workspace_id: CLIENT,
  name: 'Demo.webm', path: `${CLIENT}/demo.webm`, mime_type: 'video/webm',
  size_bytes: 4096, created_at: '2026-11-01T09:00:00Z',
};
type Snapshot = { state: string; revision: number; chapters: unknown[] };

async function media(page: Page, snapshots: Snapshot[], canEdit: boolean) {
  const clip = await readFile(new URL('../fixtures/chapter-demo.webm', import.meta.url));
  await page.route('**/storage/v1/object/sign/**', async route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const signedURL = '/object/sign/portal-private/clip?token=fixture';
      return route.fulfill({ json: payload?.paths ? payload.paths.map((path: string) => ({ path, signedURL })) : { signedURL } });
    }
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({
      status: range ? 206 : 200, body: clip.subarray(start, end + 1),
      headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}) },
    });
  });
  await page.route('**/rest/v1/portal_video_chapter_sets?**', route => route.fulfill({
    json: canEdit && !new URL(route.request().url()).searchParams.has('state')
      ? snapshots : snapshots.filter(item => item.state === 'published'),
  }));
  await page.route('**/rest/v1/rpc/portal_save_video_chapters', route => {
    expect(canEdit).toBe(true);
    const { expected, items, publish } = route.request().postDataJSON();
    const next = expected + 1;
    for (const state of publish ? ['draft', 'published'] : ['draft']) {
      const previous = snapshots.findIndex(item => item.state === state);
      const snapshot = { state, revision: next, chapters: items };
      if (previous === -1) snapshots.push(snapshot);
      else snapshots[previous] = snapshot;
    }
    return route.fulfill({ json: next });
  });
}

for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
  test(`presentation workspace at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const member = await fixture(page, 'client');
    member.state.portal_files.push(video);
    await media(page, [{ state: 'published', revision: 1, chapters: Array.from({ length: 18 }, (_, index) => ({
      id: `chapter-${index}`, title: index ? `Deliverables, responsibilities and implementation milestones ${index}` : 'Opening', start: index ? 3 + index / 100 : 0,
    })) }], false);
    await page.reload();
    await page.getByRole('button', { name: 'Play Demo.webm' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('navigation', { name: 'Video chapters' })).toBeVisible();
    await expect.poll(() => dialog.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `artifacts/screenshots/video-${process.env.VIDEO_BASELINE ? 'before' : 'after'}-${width}.png` });
    if (process.env.VIDEO_BASELINE) return;
    const box = await dialog.boundingBox();
    expect(box!.width).toBeGreaterThan(width * .95);
    expect(box!.height).toBeGreaterThan(height * .95);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const element = dialog.locator('video');
    await expect.poll(() => element.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await element.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 2; v.dataset.continuity = 'original'; });
    await dialog.getByRole('button', { name: 'Hide chapters' }).click();
    await expect(dialog.getByRole('navigation', { name: 'Video chapters' })).toBeHidden();
    await dialog.getByRole('button', { name: 'Show chapters' }).click();
    await dialog.getByRole('button', { name: 'Enter theatre mode' }).click();
    await expect(element).toHaveAttribute('data-continuity', 'original');
    expect(await element.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 0);
    await dialog.getByRole('button', { name: 'Exit theatre mode' }).click();
    await dialog.getByRole('button', { name: 'Fullscreen workspace' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    expect(member.errors).toEqual([]);
  });
}

test('staff publish chapters and a client can seek by keyboard on mobile', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const snapshots: Snapshot[] = [];
  const staff = await fixture(page);
  staff.state.portal_files.push(video);
  await media(page, snapshots, true);
  await page.reload();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  await page.getByRole('button', { name: 'Manage video chapters for Demo.webm' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: 'Client preview' })).toBeVisible();
  const player = editor.locator('video');
  await player.evaluate(async (element: HTMLVideoElement) => { await element.play(); element.pause(); });
  await editor.getByRole('button', { name: 'Add chapter at current time' }).click();
  await editor.getByLabel('Title', { exact: true }).fill('Opening');
  await editor.getByRole('button', { name: 'Capture current frame' }).click();
  await expect(editor.getByRole('status')).toContainText('Thumbnail ready');
  await editor.getByRole('button', { name: 'Add chapter manually' }).click();
  await editor.getByLabel('Title', { exact: true }).last().fill('Scope');
  await editor.getByLabel('Start time', { exact: true }).last().fill('0:03');
  await editor.getByRole('button', { name: 'Move up' }).last().click();
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('status')).toContainText('Draft saved');
  expect(snapshots.map(row => row.state)).toEqual(['draft']);
  await editor.getByRole('button', { name: 'Publish chapters' }).click();
  await expect(editor.getByRole('status')).toContainText('Chapters published');
  expect(snapshots.map(row => row.state)).toEqual(['draft', 'published']);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const client = await context.newPage();
    const member = await fixture(client, 'client');
    member.state.portal_files.push(video);
    await media(client, snapshots, false);
    await client.reload();
    await expect(client.getByRole('button', { name: /Manage video chapters/ })).toHaveCount(0);
    await client.getByRole('button', { name: 'Play Demo.webm' }).click();
    const dialog = client.getByRole('dialog');
    const scope = dialog.getByRole('navigation', { name: 'Video chapters' }).getByRole('button', { name: /Scope/ });
    const videoElement = dialog.locator('video');
    await expect.poll(() => videoElement.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
    await videoElement.evaluate((element: HTMLVideoElement) => element.pause());
    await scope.press('Enter');
    await expect(scope).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => videoElement.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(3, 0);
    await expect(dialog.getByRole('button', { name: /Jump to Opening/ })).toBeVisible();
    expect(await client.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(member.errors).toEqual([]);
  } finally {
    await context.close();
  }
  expect(staff.errors).toEqual([]);
});
