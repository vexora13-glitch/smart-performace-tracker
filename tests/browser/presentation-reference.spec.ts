import { expect, test } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fixture, CLIENT } from '../helpers/portal-fixture';

// Isolated browser evidence: an actual short uploaded WebM, never the reference PNG as video/poster.
test('reference presentation: real media controls, chapters, sidebar and responsive screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1672, height: 941 });
  const { state, errors } = await fixture(page, 'client');
  const clip = await readFile(new URL('../fixtures/chapter-demo.webm', import.meta.url));
  const id = '55555555-5555-4555-8555-555555555555';
  state.portal_files.push({ id, workspace_id: CLIENT, name: 'Statement of Work (SOW).webm', path: `${CLIENT}/presentation.webm`, mime_type: 'video/webm', size_bytes: clip.length, created_at: '2026-11-10T00:00:00Z' });
  const titles = ['Introduction & Overview', 'Project Objectives', 'Solution & Key Features', 'Scope of Work', 'Delivery Approach', 'Investment & Timeline', 'Next Steps'];
  await page.route('**/rest/v1/portal_video_chapter_sets?**', route => route.fulfill({ json: [{ state: 'published', revision: 1, chapters: titles.map((title, index) => ({ id: `chapter-${index}`, title, description: '', start: index * .7, end: null, thumbnailPath: null })) }] }));
  await page.route('**/storage/v1/object/sign/**', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { signedURL: '/object/sign/portal-private/presentation?token=fixture' } });
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({ status: range ? 206 : 200, body: clip.subarray(start, end + 1), headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}) } });
  });
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Videos', exact: true }).click();
  const video = page.locator('.presentation-page video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 0; });
  const chapters = page.getByRole('navigation', { name: 'Video chapters' });
  await chapters.getByRole('button', { name: /Scope of Work/ }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2.1, 1);
  await expect(chapters.getByRole('button', { name: /Scope of Work/ })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Back 10 seconds' }).click();
  await expect(video).toHaveJSProperty('currentTime', 0);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime >= element.duration - .01)).toBe(true);
  await page.getByRole('slider', { name: 'Seek video' }).fill('0');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.8);
  const pausedAt = await video.evaluate((element: HTMLVideoElement) => { element.pause(); return element.currentTime; });
  const expectedChapter = titles[Math.min(6, Math.floor(pausedAt / .7))];
  await expect(chapters.getByRole('button', { name: new RegExp(expectedChapter) })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Mute video' }).click();
  await expect(video).toHaveJSProperty('muted', true);
  await page.getByRole('button', { name: 'Unmute video' }).click();
  await video.evaluate((element: HTMLVideoElement) => { const track = element.addTextTrack('captions', 'English', 'en'); track.addCue(new VTTCue(0, 6, 'Synthetic caption for control verification.')); });
  await page.getByRole('button', { name: 'Toggle captions' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.textTracks[0].mode)).toBe('showing');
  await page.getByRole('button', { name: 'Toggle captions' }).click();
  await page.getByRole('button', { name: 'Mute video' }).focus();
  await page.getByRole('slider', { name: 'Video volume' }).fill('0.5');
  await expect(video).toHaveJSProperty('volume', .5);
  await page.getByRole('button', { name: 'Playback settings' }).click();
  await page.getByLabel('Playback speed').selectOption('1.5');
  await expect(video).toHaveJSProperty('playbackRate', 1.5);
  await page.getByLabel('Playback speed').press('Escape');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  let pictureInPicture = 'unsupported';
  if (await page.evaluate(() => document.pictureInPictureEnabled)) {
    await page.getByRole('button', { name: 'Picture in picture' }).click();
    await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement || document.body.textContent?.includes('Picture-in-picture is unavailable'))).toBe(true);
    pictureInPicture = await page.evaluate(() => document.pictureInPictureElement ? 'entered-and-exited' : 'browser-refused');
    if (pictureInPicture === 'entered-and-exited') {
      await page.getByRole('button', { name: 'Picture in picture' }).click();
      await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement)).toBe(false);
    }
  }
  await page.route('**/storage/v1/object/authenticated/**', route => route.fulfill({ contentType: 'video/webm', body: clip }));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Statement of Work (SOW).webm');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (url: string) => { (window as unknown as { sharedPortalUrl: string }).sharedPortalUrl = url; } } });
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const sharedUrl = await page.evaluate(() => (window as unknown as { sharedPortalUrl: string }).sharedPortalUrl);
  expect(sharedUrl).toContain(`#video=${id}`);
  expect(sharedUrl).not.toContain('token=');
  await page.goto(sharedUrl);
  await page.reload();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 0; element.playbackRate = 1; });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('vexbot')).toHaveAttribute('data-state', 'resting', { timeout: 30_000 });
  await expect(page.getByTestId('vexbot')).toHaveAttribute('data-robot', 'shown');
  await mkdir('artifacts/portal-reference', { recursive: true });
  const measurements: Record<string, unknown> = { pictureInPicture };
  for (const [name, width, height] of [['desktop', 1672, 941], ['laptop', 1366, 768], ['tablet', 768, 1024], ['mobile', 390, 844], ['small-mobile', 320, 740]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.sidebar')).toHaveCSS('width', `${width <= 560 ? width : width <= 800 ? 76 : 255}px`);
    await expect(page.getByTestId('vexbot')).toHaveAttribute('data-state', 'resting');
    await expect(page.getByTestId('vexbot')).toHaveAttribute('data-flight', 'grounded');
    if (width <= 800) {
      await expect(page.getByTestId('vexbot')).toHaveAttribute('data-dock', 'bar');
      await expect.poll(() => page.getByTestId('vexbot').getAttribute('data-ppm').then(value => Number(value))).toBeLessThan(40);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const layout = await video.evaluate(element => {
      const player = element.closest('section')!;
      const nav = player.querySelector('nav')!;
      return { width: player.clientWidth, videoBottom: element.getBoundingClientRect().bottom, chapterTop: nav.getBoundingClientRect().top,
        singleLine: Array.from(nav.querySelectorAll('strong')).every(title => getComputedStyle(title).whiteSpace === 'nowrap' && title.getBoundingClientRect().height <= parseFloat(getComputedStyle(title).lineHeight) + 1) };
    });
    expect(layout.singleLine).toBe(true);
    if (layout.width < 1100) expect(layout.chapterTop).toBeGreaterThan(layout.videoBottom);
    const fullscreenBox = await page.getByRole('button', { name: 'Enter fullscreen' }).boundingBox();
    const mediaBox = await video.locator('..').boundingBox();
    expect(fullscreenBox!.x + fullscreenBox!.width).toBeLessThanOrEqual(mediaBox!.x + mediaBox!.width);
    if (width <= 560) expect((await page.locator('.presentation-heading h1').boundingBox())!.width).toBeGreaterThan(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/portal-reference/${name}.png`, fullPage: true, animations: 'disabled' });
    if (name === 'desktop') await page.screenshot({ path: 'artifacts/portal-reference/desktop-viewport.png', animations: 'disabled' });
    measurements[name] = await video.evaluate(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, ratio: rect.width / rect.height }; });
    expect((measurements[name] as { ratio: number }).ratio).toBeCloseTo(16 / 9, 1);
  }
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'VexBot' }).click();
  await expect(page.getByTestId('vexbot-panel')).toBeVisible();
  await expect(page.getByTestId('vexbot-input')).toBeFocused();
  await writeFile('artifacts/portal-reference/measurements.json', JSON.stringify(measurements, null, 2));
  expect(errors).toEqual([]);
});
