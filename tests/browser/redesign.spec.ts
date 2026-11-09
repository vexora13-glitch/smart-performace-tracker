import { expect, test, type Page } from '@playwright/test';
import { fixture, CLIENT, THREAD } from '../helpers/portal-fixture';

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('main > .page-content')).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('brand matches the live reference, responsive shell keeps state and dialogs restore focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors } = await fixture(page);
  await settled(page);
  expect(
    await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return [
        css.getPropertyValue('--vx-bg').trim(),
        css.getPropertyValue('--vx-accent').trim(),
        document.fonts.check('14px Geist'),
      ];
    }),
  ).toEqual(['#09172b', '#8264ff', true]);
  await page.screenshot({ path: 'artifacts/redesign/after/dashboard-desktop.png', fullPage: true });
  await page.getByLabel('Search clients').fill('Acme');
  const canvas = await page.getByTestId('vexbot-canvas').elementHandle();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByLabel('Search clients')).toHaveValue('Acme');
  expect(
    await canvas?.evaluate(
      (element) => element === document.querySelector('[data-testid=vexbot-canvas]'),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A new connection.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add client', exact: true })).toBeFocused();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  expect(errors).toEqual([]);
});

test('mobile navigation and assistant remain keyboard accessible without losing a draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await fixture(page, 'client');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Your workspace' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Messages' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Your workspace' })).toBeHidden();
  await page.getByRole('button', { name: /Website launch Acme Studio/ }).click();
  await page.getByLabel('Your reply').fill('A draft to preserve');
  await page.getByTestId('vexbot-launcher').click();
  await expect(page.getByTestId('vexbot-input')).toBeFocused();
  await page.getByTestId('vexbot-input').fill('An assistant draft');
  await noOverflow(page);
  await expect(page.getByTestId('vexbot-panel')).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/redesign/after/assistant-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vexbot-panel')).toBeHidden();
  await expect(page.getByTestId('vexbot-launcher')).toBeFocused();
  await expect(page.getByLabel('Your reply')).toHaveValue('A draft to preserve');
  await page.getByTestId('vexbot-launcher').click();
  await expect(page.getByTestId('vexbot-input')).toHaveValue('An assistant draft');
  await page.keyboard.press('Escape');
  await settled(page);
  await page.screenshot({ path: 'artifacts/redesign/after/messages-mobile.png' });
  expect(errors).toEqual([]);
});

test('reduced motion exposes content immediately and disables nonessential CSS motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { errors } = await fixture(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Clients', exact: true })
    .click();
  await expect(page.locator('main > .page-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('main > .page-content')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A new connection.' })).toHaveCSS(
    'animation-name',
    'none',
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('vexbot-launcher').click();
  await expect(page.getByTestId('vexbot-panel')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});

test('file categories retain backend metadata and download names; media dialog remains native', async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  const file = {
    workspace_id: CLIENT,
    created_at: new Date().toISOString(),
    size_bytes: 120,
    uploaded_by: CLIENT,
  };
  state.portal_files.push(
    { ...file, id: 'doc', path: 'brief.txt', name: 'Project brief.txt', mime_type: 'text/plain' },
    {
      ...file,
      id: 'video',
      path: 'walkthrough.webm',
      name: 'Walkthrough.webm',
      mime_type: 'video/webm',
    },
  );
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  await page.locator('.file-tabs').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('Project brief.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('Walkthrough.webm', { exact: true })).toBeHidden();
  await page.route('**/storage/v1/object/authenticated/**', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'Synthetic project brief' }),
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Project brief.txt' }).click();
  expect((await download).suggestedFilename()).toBe('Project brief.txt');
  await page.locator('.file-tabs').getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(page.getByText('Walkthrough.webm', { exact: true })).toBeVisible();
  await expect(page.getByText('Project brief.txt', { exact: true })).toBeHidden();
  // Generate a real, silent WebM locally so playback is tested without external media or credentials.
  const videoBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (let i = 0; i < 6; i++) {
      context.fillStyle = i % 2 ? '#c8f56a' : '#141817';
      context.fillRect(0, 0, 160, 90);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return btoa(
      String.fromCharCode(
        ...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()),
      ),
    );
  });
  await page.route('**/storage/v1/object/sign/**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'video/webm', body: Buffer.from(videoBase64, 'base64') })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Play Walkthrough.webm' }).click();
  await expect(page.getByRole('dialog', { name: 'Walkthrough.webm' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause video' })).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Play Walkthrough.webm' })).toBeFocused();
  await settled(page);
  await page.screenshot({ path: 'artifacts/redesign/after/workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.getByTestId('vexbot-launcher').click();
  await expect(page.getByTestId('vexbot-panel')).toHaveCSS('opacity', '1');
  await noOverflow(page);
  expect(
    await page.locator('.files-panel').evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(300);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('login uses the shared brand and visible keyboard focus at desktop and mobile sizes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.login-card')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'artifacts/redesign/after/login-desktop.png', fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vexora Digital website' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Vexora Digital website' })).toHaveCSS(
    'outline-style',
    'solid',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/redesign/after/login-mobile.png', fullPage: true });
});

test('polling does not move readers away from earlier messages', async ({ page }) => {
  const { state, errors } = await fixture(page);
  for (let i = 0; i < 24; i++)
    state.portal_messages.push({
      id: `older-${i}`,
      conversation_id: THREAD,
      author_id: CLIENT,
      body: `Earlier message ${i}. Project details for the review.`,
      created_at: new Date().toISOString(),
    });
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Messages', exact: true })
    .click();
  await page.getByRole('button', { name: /Website launch Acme Studio/ }).click();
  const history = page.getByRole('log', { name: 'Conversation messages' });
  await expect.poll(() => history.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await history.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  state.portal_messages.push({
    id: 'new-incoming',
    conversation_id: THREAD,
    author_id: CLIENT,
    body: 'A new incoming message',
    created_at: new Date().toISOString(),
  });
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await expect(page.getByRole('button', { name: 'New messages · Jump to latest' })).toBeVisible();
  expect(await history.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'New messages · Jump to latest' }).click();
  await expect
    .poll(() => history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThan(64);
  expect(errors).toEqual([]);
});

test('knowledge and settings tabs support arrow keys and fit narrow screens', async ({ page }) => {
  const { state, errors } = await fixture(page);
  state.vexbot_settings = [
    {
      id: '1',
      version: 1,
      business_profile: { name: 'Vexora Digital', summary: 'Approved business information.' },
      tone: 'friendly',
      detail: 'standard',
      guidance: '',
      updated_at: new Date().toISOString(),
    },
  ];
  await page.route('**/auth/v1/factors', (route) =>
    route.fulfill({ json: { all: [], totp: [], phone: [] } }),
  );
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'VexBot', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: 'Knowledge', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Uploads', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Business profile', exact: true })).toBeFocused();
  await expect(page.getByLabel('Business name')).toHaveValue('Vexora Digital');
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  await page.screenshot({ path: 'artifacts/redesign/after/admin-mobile.png' });
  expect(errors).toEqual([]);
});
