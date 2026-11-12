import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { CLIENT, fixture } from '../helpers/portal-fixture';

const demo = {
  id: '66666666-6666-4666-8666-666666666661', workspace_id: CLIENT,
  name: 'Demo.webm', path: `${CLIENT}/a/demo.webm`, mime_type: 'video/webm',
  size_bytes: 4096, created_at: '2026-11-02T09:00:00Z',
};
const pending = {
  ...demo, id: '66666666-6666-4666-8666-666666666662', name: 'Proposal.webm', path: `${CLIENT}/b/proposal.webm`,
  created_at: '2026-11-01T09:00:00Z',
};
const pdf = {
  id: '66666666-6666-4666-8666-666666666663', workspace_id: CLIENT, name: 'Statement.pdf',
  path: `${CLIENT}/c/statement.pdf`, mime_type: 'application/pdf', size_bytes: 2048, created_at: '2026-10-30T09:00:00Z',
};
type Row = { file_id: string; auto_path: string | null; custom_path: string | null; duration_seconds: number | null; auto_failed_at: string | null; updated_at: string };
type Call = { video: string; source: string; path: string | null; duration: number | null };

/** A small real PNG (gradient) so decoding, cropping and JPEG encoding run for real. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set([(x * 255) / width, (y * 255) / height, 160], y * (width * 3 + 1) + 1 + x * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function media(page: Page, thumbs: Row[]) {
  const clip = await readFile(new URL('../fixtures/chapter-demo.webm', import.meta.url));
  const image = png(64, 36);
  const calls: Call[] = [];
  const uploads: string[] = [];
  const removed: string[] = [];
  await page.route('**/storage/v1/object/sign/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      if (payload?.paths)
        return route.fulfill({ json: payload.paths.map((path: string) => ({ path, signedURL: `/object/sign/portal-private/${path}?token=t`, error: null })) });
      return route.fulfill({ json: { signedURL: '/object/sign/portal-private/clip.webm?token=t' } });
    }
    if (request.url().includes('/video-thumbnails/'))
      return route.fulfill({ body: image, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({
      status: range ? 206 : 200, body: clip.subarray(start, end + 1),
      headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}) },
    });
  });
  await page.route('**/storage/v1/object/portal-private/**', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/object/portal-private/')[1]);
    if (route.request().method() === 'POST') uploads.push(path);
    return route.fulfill({ json: { Key: `portal-private/${path}`, Id: crypto.randomUUID() } });
  });
  await page.route('**/storage/v1/object/list/portal-private', (route) => {
    const { prefix } = route.request().postDataJSON();
    return route.fulfill({ json: prefix.includes('video-thumbnails') ? [{ name: 'old.jpg', id: 'object-1' }] : [] });
  });
  await page.route('**/storage/v1/object/portal-private', (route) => {
    if (route.request().method() === 'DELETE') removed.push(...route.request().postDataJSON().prefixes);
    return route.fulfill({ json: [] });
  });
  await page.route('**/rest/v1/portal_video_thumbnails?**', (route) => {
    const ids = /in\.\(([^)]*)\)/.exec(new URL(route.request().url()).searchParams.get('file_id') || '')?.[1].split(',') ?? [];
    return route.fulfill({ json: thumbs.filter((row) => ids.includes(row.file_id)) });
  });
  await page.route('**/rest/v1/rpc/portal_save_video_thumbnail', (route) => {
    const call = route.request().postDataJSON() as Call;
    calls.push(call);
    let row = thumbs.find((item) => item.file_id === call.video);
    if (!row) thumbs.push((row = { file_id: call.video, auto_path: null, custom_path: null, duration_seconds: null, auto_failed_at: null, updated_at: '' }));
    let discard: string | null = null;
    if (call.source === 'auto') {
      if (row.auto_path) discard = call.path;
      else row.auto_path = call.path;
    } else {
      discard = row.custom_path;
      row.custom_path = call.source === 'custom' ? call.path : null;
    }
    row.duration_seconds = call.duration ?? row.duration_seconds;
    return route.fulfill({ json: { ...row, discard } });
  });
  return { calls, uploads, removed };
}

const existing = (): Row[] => [{
  file_id: demo.id, auto_path: `${CLIENT}/video-thumbnails/${demo.id}/00000000-0000-4000-8000-000000000001.jpg`,
  custom_path: null, duration_seconds: 510, auto_failed_at: null, updated_at: '2026-11-02T09:00:00Z',
}];
const pathPattern = (file: string) => new RegExp(`^${CLIENT}/video-thumbnails/${file}/[0-9a-f-]{36}\\.jpg$`);

test('admins see 16:9 thumbnails, backfill missing ones, pick frames, crop images and restore', async ({ page }) => {
  test.setTimeout(90_000);
  const staff = await fixture(page);
  staff.state.portal_files.push(demo, pending, pdf);
  const thumbs = existing();
  const net = await media(page, thumbs);
  await page.reload();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();

  const rows = page.locator('.files-panel .file-row');
  const demoRow = rows.filter({ hasText: 'Demo.webm' });
  const pdfRow = rows.filter({ hasText: 'Statement.pdf' });
  await expect(demoRow.locator('.video-thumb img')).toHaveAttribute('src', /video-thumbnails/);
  await expect(demoRow.locator('.video-thumb-play')).toHaveText('8:30');
  // Documents keep their original icon and controls.
  await expect(pdfRow.locator('.video-thumb')).toHaveCount(0);
  await expect(pdfRow.locator('.file-icon')).toBeVisible();
  await expect(pdfRow.getByRole('button', { name: 'Preview Statement.pdf' })).toBeVisible();
  // Thumbnail is 16:9; the admin's change-thumbnail icon sits just under it, always visible.
  const thumb = (await demoRow.locator('.video-thumb').boundingBox())!;
  expect(Math.abs(thumb.width / thumb.height - 16 / 9)).toBeLessThan(0.03);
  const edit = demoRow.getByRole('button', { name: 'Edit thumbnail for Demo.webm' });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveAttribute('title', 'Change thumbnail');
  const icon = (await edit.boundingBox())!;
  expect(icon.y).toBeGreaterThanOrEqual(thumb.y + thumb.height);
  expect(icon.y - (thumb.y + thumb.height)).toBeLessThan(10);
  expect(icon.x).toBeGreaterThanOrEqual(thumb.x - 1);
  expect(icon.x + icon.width).toBeLessThanOrEqual(thumb.x + thumb.width + 1);
  // The row grows only by the small icon, not a full extra line of controls.
  expect((await demoRow.boundingBox())!.height).toBeLessThanOrEqual((await pdfRow.boundingBox())!.height + 32);
  // Existing controls are preserved.
  for (const name of ['Play Demo.webm', 'Manage video chapters for Demo.webm', 'Download Demo.webm', 'Remove Demo.webm'])
    await expect(demoRow.getByRole('button', { name })).toBeVisible();

  // Controlled backfill: the video without a thumbnail is generated once, in the background.
  await expect.poll(() => net.calls.filter((call) => call.source === 'auto').length, { timeout: 30_000 }).toBe(1);
  const generated = net.calls.find((call) => call.source === 'auto')!;
  expect(generated.video).toBe(pending.id);
  expect(generated.path).toMatch(pathPattern(pending.id));
  expect(net.uploads).toContain(generated.path);
  await expect(rows.filter({ hasText: 'Proposal.webm' }).locator('.video-thumb img')).toHaveAttribute('src', /video-thumbnails/);

  // Clicking the thumbnail opens the existing player.
  await demoRow.locator('.video-thumb-media').click();
  const player = page.getByRole('dialog', { name: 'Demo.webm' });
  await expect(player.locator('video')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(player).toBeHidden();

  // Option A: select a frame from the video.
  await demoRow.getByRole('button', { name: 'Edit thumbnail for Demo.webm' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit thumbnail' });
  await expect(editor.getByText('Automatic thumbnail')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Restore automatic thumbnail' })).toHaveCount(0);
  const seek = editor.getByLabel('Video position');
  await expect(seek).toBeEnabled({ timeout: 20_000 });
  await seek.fill('2');
  await expect.poll(() => editor.locator('video').evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - 2) < 0.05)).toBe(true);
  await editor.getByRole('button', { name: 'Next frame' }).click();
  await expect.poll(() => editor.locator('video').evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2)).toBe(true);
  await editor.getByRole('button', { name: 'Use this frame' }).click();
  await expect(editor.getByRole('img', { name: 'Selected frame preview' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save thumbnail' }).click();
  await expect(editor).toBeHidden();
  const frameCall = net.calls.at(-1)!;
  expect(frameCall).toMatchObject({ video: demo.id, source: 'custom' });
  expect(frameCall.path).toMatch(pathPattern(demo.id));
  await expect(demoRow.locator('.video-thumb img')).toHaveAttribute('src', new RegExp(frameCall.path!.split('/').at(-1)!));

  // Option B: upload, crop and save a custom image.
  await demoRow.getByRole('button', { name: 'Edit thumbnail for Demo.webm' }).click();
  await expect(editor.getByText('Custom thumbnail')).toBeVisible();
  await editor.getByRole('tab', { name: 'Upload image' }).click();
  await editor.getByLabel('Upload a custom thumbnail image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png(400, 400) });
  const stage = editor.getByRole('img', { name: /Thumbnail crop preview/ });
  await expect(stage).toBeVisible();
  await editor.getByRole('slider', { name: 'Zoom' }).fill('1.5');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await stage.focus();
  await page.keyboard.press('ArrowUp');
  await editor.getByRole('button', { name: 'Save thumbnail' }).click();
  await expect(editor).toBeHidden();
  const imageCall = net.calls.at(-1)!;
  expect(imageCall).toMatchObject({ video: demo.id, source: 'custom' });
  expect(imageCall.path).not.toBe(frameCall.path);
  // The replaced custom thumbnail is removed from storage.
  await expect.poll(() => net.removed).toContain(frameCall.path);

  // Restore the automatic thumbnail.
  await demoRow.getByRole('button', { name: 'Edit thumbnail for Demo.webm' }).click();
  await editor.getByRole('button', { name: 'Restore automatic thumbnail' }).click();
  await expect(editor).toBeHidden();
  expect(net.calls.at(-1)).toMatchObject({ video: demo.id, source: 'restore', path: null });
  await expect(demoRow.locator('.video-thumb img')).toHaveAttribute('src', /0001\.jpg/);
  await expect.poll(() => net.removed).toContain(imageCall.path);

  // Deleting a video removes its thumbnail folder objects.
  await demoRow.getByRole('button', { name: 'Remove Demo.webm' }).click();
  await page.getByRole('button', { name: 'Remove file' }).click();
  await expect.poll(() => net.removed).toContain(`${CLIENT}/video-thumbnails/${demo.id}/old.jpg`);
  expect(net.removed).toContain(demo.path);
  expect(staff.errors).toEqual([]);
});

test('clients see thumbnails read-only: no edit control and no generation', async ({ page }) => {
  const member = await fixture(page, 'client');
  member.state.portal_files.push(demo, pending, pdf);
  const net = await media(page, existing());
  await page.reload();
  const demoRow = page.locator('.files-panel .file-row').filter({ hasText: 'Demo.webm' });
  await expect(demoRow.locator('.video-thumb img')).toHaveAttribute('src', /video-thumbnails/);
  // The video without a thumbnail shows the placeholder.
  await expect(page.locator('.files-panel .file-row').filter({ hasText: 'Proposal.webm' }).locator('.video-thumb-placeholder')).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit thumbnail/ })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Edit thumbnail' })).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(net.calls).toEqual([]);
  expect(net.uploads).toEqual([]);
  await demoRow.locator('.video-thumb-media').click();
  await expect(page.getByRole('dialog', { name: 'Demo.webm' }).locator('video')).toBeVisible();
  expect(member.errors).toEqual([]);
});

test('before the migration is applied, admins still see the icon and are told why saving is off', async ({ page }) => {
  const staff = await fixture(page);
  staff.state.portal_files.push(demo);
  const net = await media(page, []);
  await page.route('**/rest/v1/portal_video_thumbnails?**', (route) =>
    route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.portal_video_thumbnails'" } }));
  await page.reload();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  const row = page.locator('.files-panel .file-row').filter({ hasText: 'Demo.webm' });
  await expect(row.locator('.video-thumb-placeholder')).toBeVisible();
  await row.getByRole('button', { name: 'Edit thumbnail for Demo.webm' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit thumbnail' });
  await expect(editor.getByRole('alert')).toContainText('20261112100000_portal_video_thumbnails');
  await expect(editor.getByRole('button', { name: 'Save thumbnail' })).toBeDisabled();
  await page.waitForTimeout(2000);
  expect(net.calls).toEqual([]);
  expect(staff.errors).toEqual([]);
});

test('a newly uploaded video gets its thumbnail from the local file', async ({ page }) => {
  test.setTimeout(60_000);
  const staff = await fixture(page);
  const net = await media(page, []);
  await page.reload();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  const clip = await readFile(new URL('../fixtures/chapter-demo.webm', import.meta.url));
  await page.getByLabel('Upload client file').setInputFiles({ name: 'Kickoff.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.getByRole('status').filter({ hasText: 'File shared with this client.' })).toBeVisible();
  await expect.poll(() => net.calls.length, { timeout: 30_000 }).toBe(1);
  const saved = staff.state.portal_files[0] as { id: string };
  expect(net.calls[0]).toMatchObject({ video: saved.id, source: 'auto' });
  expect(net.calls[0].path).toMatch(pathPattern(saved.id));
  expect(net.calls[0].duration).toBeGreaterThan(0);
  expect(staff.errors).toEqual([]);
});

for (const [width, height] of [[1366, 768], [768, 1024], [390, 844]]) {
  test(`thumbnail rows and editor fit at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const staff = await fixture(page);
    staff.state.portal_files.push({ ...demo, name: 'A very long presentation recording name for the private sale proposal.webm' }, pdf);
    await media(page, existing());
    await page.reload();
    await page.getByRole('button', { name: /Acme Studio alice/ }).click();
    const row = page.locator('.files-panel .file-row').first();
    await expect(row.locator('.video-thumb img')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const geometry = await row.evaluate((node) => {
      const box = (selector: string) => node.querySelector(selector)!.getBoundingClientRect();
      const thumb = box('.video-thumb');
      const copy = box('.row-copy');
      const buttons = [...node.querySelectorAll(':scope > button')].map((button) => button.getBoundingClientRect());
      const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return { ratio: thumb.width / thumb.height, overlap: [copy, ...buttons].some((item) => overlaps(item, thumb)) || buttons.some((item) => overlaps(item, copy)) };
    });
    expect(Math.abs(geometry.ratio - 16 / 9)).toBeLessThan(0.03);
    expect(geometry.overlap).toBe(false);
    await row.getByRole('button', { name: /Edit thumbnail for/ }).click();
    const editor = page.getByRole('dialog', { name: 'Edit thumbnail' });
    await expect(editor.getByLabel('Video position')).toBeEnabled({ timeout: 20_000 });
    const dialog = (await editor.boundingBox())!;
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    await expect(editor.getByRole('button', { name: 'Save thumbnail' })).toBeInViewport({ ratio: 0.1 }).catch(async () => {
      await editor.getByRole('button', { name: 'Save thumbnail' }).scrollIntoViewIfNeeded();
      await expect(editor.getByRole('button', { name: 'Save thumbnail' })).toBeInViewport();
    });
    await page.screenshot({ path: `artifacts/screenshots/video-thumbnails-editor-${width}.png` });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `artifacts/screenshots/video-thumbnails-list-${width}.png` });
    expect(staff.errors).toEqual([]);
  });
}
