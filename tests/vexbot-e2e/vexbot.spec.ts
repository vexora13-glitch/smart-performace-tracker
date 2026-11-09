import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { totp } from '../helpers/totp.mjs';

type Seed = { tag: string; password: string; staff: { email: string }; alice: { email: string; company: string }; bob: { email: string; company: string }; vera: { email: string } };
const seed = (): Seed => JSON.parse(readFileSync('artifacts/vexbot-seed.json', 'utf8'));
const shot = (page: Page, name: string) => page.screenshot({ path: `artifacts/screenshots/${name}.png` });

async function login(page: Page, email: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(seed().password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('vexbot-launcher')).toBeVisible();
  return errors;
}
const robot = (page: Page) => page.evaluate(() => ({ ...(document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset }));
async function resting(page: Page) {
  await page.waitForFunction(() => {
    const d = (document.querySelector('[data-testid=vexbot]') as HTMLElement | null)?.dataset;
    return d?.state === 'resting' && d.flight === 'grounded';
  }, null, { timeout: 30_000 });
}
/** Records every value a robot data attribute takes, frame by frame. */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Record<string, string[]> };
    w.__seen = { flight: [], base: [], place: [] };
    const tick = () => {
      const d = (document.querySelector('[data-testid=vexbot]') as HTMLElement | null)?.dataset;
      if (d) for (const key of ['flight', 'base', 'place']) if (d[key] && !w.__seen[key].includes(d[key]!)) w.__seen[key].push(d[key]!);
      requestAnimationFrame(tick);
    };
    tick();
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);

/** Counts purple and lime pixels where the robot is drawn, from a real screenshot of the WebGL canvas. */
async function robotPixels(page: Page) {
  const d = await robot(page);
  const ppm = Number(d.ppm), x = Number(d.x), y = Number(d.y);
  const clip = { x: Math.max(0, x - 0.8 * ppm), y: Math.max(0, y - 1.9 * ppm), width: 1.6 * ppm, height: 2 * ppm };
  const image = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let purple = 0, lime = 0, metal = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (b > 170 && b - g > 50 && r > 90 && r < b) purple++;
      if (g > 180 && g - b > 80 && r > 120 && r < g) lime++;
      if (Math.abs(r - g) < 12 && Math.abs(g - b) < 14 && r > 40 && r < 200) metal++;
    }
    return { purple, lime, metal };
  }, image.toString('base64'));
}

test.describe.configure({ mode: 'serial' });

test.describe('desktop Chrome', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('staff: MFA, knowledge upload, review, publish, profile and preview', async ({ page }) => {
    const errors = await login(page, seed().staff.email);
    await page.getByRole('button', { name: 'Vexbot' }).first().click();
    await expect(page.getByTestId('vexbot-admin')).toBeVisible();
    await expect(page.getByTestId('vexbot-aal')).toHaveText(/View only/);
    await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
    const secret = (await page.getByTestId('vexbot-mfa-secret').textContent())!.trim();
    await shot(page, 'desktop-01-admin-mfa-enrol');
    await page.getByTestId('vexbot-mfa-code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByTestId('vexbot-aal')).toHaveText(/Verified for changes/);
    // Synthetic local factor only, kept in git-ignored artifacts for the later staff session.
    writeFileSync('artifacts/vexbot-mfa.json', JSON.stringify({ secret, used: Date.now() }));

    await page.getByText('Upload a document').click();
    await page.getByLabel('Title').first().fill('Synthetic: Care plans');
    await page.getByTestId('vexbot-knowledge-file').setInputFiles({ name: 'care-plans.txt', mimeType: 'text/plain', buffer: Buffer.from('Care plans\n\nThe monthly care plan includes two hours of website changes and a security update check.') });
    await page.getByRole('button', { name: 'Upload and extract text' }).click();
    await expect(page.getByTestId('vexbot-doc-content')).toHaveValue(/two hours of website changes/);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByTestId('vexbot-publish')).toBeVisible();
    await page.getByTestId('vexbot-publish').click();
    await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
    await shot(page, 'desktop-02-admin-knowledge-published');

    await page.getByRole('tab', { name: 'Business profile' }).click();
    await expect(page.getByTestId('vexbot-profile-hours')).toHaveValue(/9am to 5pm/);
    await shot(page, 'desktop-03-admin-business-profile');
    await page.getByRole('tab', { name: 'Behaviour' }).click();
    await page.getByText('Concise', { exact: true }).click();
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByTestId('vexbot-preview-question').fill('What does the monthly care plan include?');
    await page.getByRole('button', { name: 'Preview answer' }).click();
    await expect(page.getByTestId('vexbot-preview-answer')).toContainText('two hours of website changes');
    await expect(page.getByTestId('vexbot-preview-answer')).toContainText('Sources: Synthetic: Care plans');
    await shot(page, 'desktop-04-admin-preview');
    await page.getByRole('tab', { name: 'Behaviour' }).click();
    await page.getByTestId('vexbot-save-settings').click();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText(/Version \d+ · current/)).toBeVisible();
    await shot(page, 'desktop-05-admin-history');
    expect(errors).toEqual([]);
  });

  test('client: real WebGL purple robot, scroll flight, landing, walking and robot click', async ({ page }) => {
    const errors = await login(page, seed().alice.email);
    await resting(page);
    const docked = await robot(page);
    expect(docked.dock).toBe('perch');
    expect(Number(docked.x)).toBeLessThan(233);
    const pixels = await robotPixels(page);
    expect(pixels.metal).toBeGreaterThan(400);
    expect(pixels.purple).toBeGreaterThan(20);
    expect(pixels.lime).toBe(0);
    await shot(page, 'desktop-06-client-workspace-robot');

    await record(page);
    await page.mouse.move(800, 500);
    let captured = false;
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, 40);
      await page.waitForTimeout(70);
      if (!captured && (await robot(page)).flight === 'cruise') { await shot(page, 'desktop-07-client-scroll-flight'); captured = true; }
    }
    expect(captured).toBe(true);
    await resting(page);
    expect((await seen(page)).flight).toEqual(expect.arrayContaining(['takeoff', 'cruise', 'approach', 'touchdown', 'grounded']));
    const landed = await robot(page);
    expect(landed.x).toBe(docked.x);
    expect(landed.y).toBe(docked.y);

    await page.evaluate(() => scrollTo(0, 0));
    await resting(page);
    await record(page);
    await page.getByRole('button', { name: /^Messages/ }).first().click();
    await page.waitForFunction(() => (document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset.place === 'Messages:perch');
    await resting(page);
    expect((await seen(page)).base).toEqual(expect.arrayContaining(['Walk']));
    await page.waitForFunction(() => (document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset.base === 'SeatedIdle', null, { timeout: 10_000 });
    await shot(page, 'desktop-08-client-messages-seated');

    await page.getByTestId('vexbot-body').click();
    await expect(page.getByTestId('vexbot-panel')).toBeVisible();
    await page.waitForFunction(() => (document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset.place === 'panel');
    await expect(page.getByTestId('vexbot-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vexbot-panel')).toBeHidden();
    await expect(page.getByTestId('vexbot-launcher')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('client: grounded answers with citations, honest no-answer, attachments, voice and history', async ({ page, context }) => {
    await context.grantPermissions(['microphone'], { origin: 'http://localhost:5173' });
    const errors = await login(page, seed().alice.email);
    await page.getByTestId('vexbot-launcher').click();
    await expect(page.getByTestId('vexbot-workspace')).toHaveValue(/.+/);
    await page.getByTestId('vexbot-input').fill('When is the launch workshop scheduled?');
    await page.keyboard.press('Enter');
    const answer = page.getByTestId('vexbot-assistant').last();
    await expect(answer).toContainText('9 June at 10am');
    await expect(answer.getByTestId('vexbot-sources')).toContainText('Synthetic: Acme project plan');
    await answer.locator('summary', { hasText: 'Synthetic: Acme project plan' }).click();
    await shot(page, 'desktop-09-client-cited-answer');

    await page.getByTestId('vexbot-input').fill('What is the capital of France?');
    await page.getByTestId('vexbot-send').click();
    const none = page.getByTestId('vexbot-assistant').last();
    await expect(none).toHaveAttribute('data-outcome', 'no_answer');
    await expect(none).toContainText("won't guess");
    await expect(none.getByTestId('vexbot-contact')).toBeVisible();

    await page.getByTestId('vexbot-file').setInputFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic brief: we would like a booking page.') });
    await expect(page.getByTestId('vexbot-attachments')).toContainText('Passed malware scan · awaiting Vexora review');
    await page.getByTestId('vexbot-input').fill('Can you use my brief?');
    await page.getByTestId('vexbot-send').click();
    await expect(page.getByTestId('vexbot-assistant').last()).toContainText('“brief.txt” passed the malware check and is waiting for the Vexora team to review it');
    await shot(page, 'desktop-10-client-attachment-status');

    // Turn-based voice with Chrome's fake microphone; the local mock transcriber returns a fixed question.
    await page.getByTestId('vexbot-mic').click();
    await expect(page.getByTestId('vexbot-status')).toContainText('Listening');
    await expect(page.locator('[data-testid=vexbot]')).toHaveAttribute('data-status', 'recording');
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect(page.locator('[data-testid=vexbot]')).toHaveAttribute('data-status', 'paused');
    await expect(page.getByTestId('vexbot-status')).toContainText('Microphone muted');
    await page.getByRole('button', { name: 'Resume microphone', exact: true }).click();
    await expect(page.locator('[data-testid=vexbot]')).toHaveAttribute('data-status', 'recording');
    await page.waitForTimeout(1500);
    await page.getByTestId('vexbot-mic').click();
    await expect(page.getByTestId('vexbot-user').last()).toContainText('What are your support hours?');
    await expect(page.getByTestId('vexbot-assistant').last()).toContainText('9am to 5pm');
    await expect(page.getByTestId('vexbot-assistant').last()).toContainText('Vexora business profile');
    await shot(page, 'desktop-11-client-voice-turn');

    await page.getByTestId('vexbot-new').click();
    await expect(page.getByTestId('vexbot-log')).toContainText('Answers come only from');
    await page.getByTestId('vexbot-history').click();
    await page.getByTestId('vexbot-history-list').getByRole('button').first().click();
    await expect(page.getByTestId('vexbot-log')).toContainText('9am to 5pm');
    await shot(page, 'desktop-12-client-history');
    expect(errors).toEqual([]);
  });

  test('client: Keep still and Hide robot; read-only member; source revocation', async ({ page, browser }) => {
    await login(page, seed().alice.email);
    await resting(page);
    await page.getByTestId('vexbot-launcher').click();
    await page.getByTestId('vexbot-still').click();
    await page.keyboard.press('Escape');
    await record(page);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 160); await page.waitForTimeout(40); }
    await page.waitForTimeout(800);
    expect((await seen(page)).flight).toEqual(['grounded']);
    await page.getByTestId('vexbot-launcher').click();
    await page.getByTestId('vexbot-still').click();
    await page.getByTestId('vexbot-hide').click();
    await expect(page.getByTestId('vexbot-canvas')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vexbot-launcher')).toBeVisible();
    await shot(page, 'desktop-13-robot-hidden-launcher');
    await page.getByTestId('vexbot-launcher').click();
    await page.getByTestId('vexbot-hide').click();

    const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(viewer, seed().vera.email);
    await expect(viewer.getByText('Your access is read-only, so uploads are turned off.')).toBeVisible();
    await expect(viewer.getByTestId('workspace-private-upload')).toHaveCount(0);
    await viewer.getByTestId('vexbot-launcher').click();
    await expect(viewer.getByLabel('Attach files')).toHaveCount(0);
    await viewer.getByTestId('vexbot-input').fill('When is the launch workshop scheduled?');
    await viewer.getByTestId('vexbot-send').click();
    await expect(viewer.getByTestId('vexbot-assistant').last()).toContainText('9 June');
    await viewer.keyboard.press('Escape');
    await viewer.getByRole('button', { name: /^Messages/ }).first().click();
    await viewer.getByText('Launch timing').click();
    await expect(viewer.getByTestId('read-only-note')).toBeVisible();
    await shot(viewer, 'desktop-14-read-only-member');

    // Staff retire the plan; the client's saved answer is withdrawn on next view.
    const staff = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(staff, seed().staff.email);
    await staff.getByRole('button', { name: 'Vexbot' }).first().click();
    await expect(staff.getByTestId('vexbot-aal')).toHaveText(/View only/, { timeout: 5000 });
    const { secret, used } = JSON.parse(readFileSync('artifacts/vexbot-mfa.json', 'utf8'));
    // A TOTP code is accepted once per 30-second window, so wait for a fresh one if needed.
    if (Math.floor(Date.now() / 30000) === Math.floor(used / 30000)) await staff.waitForTimeout(30000 - (Date.now() % 30000) + 500);
    await staff.getByTestId('vexbot-mfa-code').fill(totp(secret));
    await staff.getByRole('button', { name: 'Verify' }).click();
    await expect(staff.getByTestId('vexbot-aal')).toHaveText(/Verified for changes/);
    await staff.getByTestId('vexbot-doc').filter({ hasText: 'Synthetic: Acme project plan' }).filter({ hasText: 'Published' }).first().click();
    await staff.getByTestId('vexbot-retire').click();
    await expect(staff.getByRole('status').filter({ hasText: 'Retired' })).toBeVisible();
    await shot(staff, 'desktop-15-admin-retired-source');

    await page.getByTestId('vexbot-history').click();
    await page.getByTestId('vexbot-history-list').getByRole('button', { name: /When is the launch workshop scheduled/ }).first().click();
    await expect(page.getByTestId('vexbot-log')).toContainText('no longer available because a document it relied on has been withdrawn');
    await expect(page.getByTestId('vexbot-log')).not.toContainText('9 June at 10am');
    await shot(page, 'desktop-16-client-answer-withdrawn');
    await staff.close();
    await viewer.close();
  });
});

test.describe('without WebGL and with reduced motion', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('the text launcher and assistant work when WebGL is unavailable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    const page = await context.newPage();
    await login(page, seed().alice.email);
    await expect(page.locator('[data-testid=vexbot]')).toHaveAttribute('data-webgl', 'unavailable', { timeout: 15_000 });
    await page.getByTestId('vexbot-launcher').click();
    await page.getByTestId('vexbot-input').fill('How soon do new clients receive a welcome pack?');
    await page.getByTestId('vexbot-send').click();
    await expect(page.getByTestId('vexbot-assistant').last()).toContainText('two business days');
    await shot(page, 'desktop-17-no-webgl-text-launcher');
    await context.close();
  });

  test('reduced motion holds a still frame and never flies', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await login(page, seed().alice.email);
    await resting(page);
    await record(page);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 160); await page.waitForTimeout(40); }
    await page.waitForTimeout(800);
    expect((await seen(page)).flight).toEqual(['grounded']);
    await context.close();
  });
});

test.describe('mobile Chrome (Pixel 7)', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('robot in the reserved bar, bottom sheet, cited answer and keyboard-safe composer', async ({ page }) => {
    const errors = await login(page, seed().alice.email);
    await resting(page);
    expect((await robot(page)).dock).toBe('bar');
    const pixels = await robotPixels(page);
    expect(pixels.metal).toBeGreaterThan(40);
    expect(pixels.lime).toBe(0);
    await shot(page, 'mobile-01-client-bar-robot');
    await record(page);
    await page.evaluate(async () => { for (let i = 0; i < 16; i++) { scrollBy(0, 90); await new Promise((r) => setTimeout(r, 40)); } });
    await resting(page);
    expect((await seen(page)).flight).toEqual(expect.arrayContaining(['takeoff', 'grounded']));
    await page.getByTestId('vexbot-body').tap();
    await expect(page.getByTestId('vexbot-panel')).toHaveClass(/sheet/);
    const input = page.getByTestId('vexbot-input');
    await input.tap();
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport();
    // Simulate an on-screen keyboard: the sheet follows the visual viewport offset the component publishes.
    await page.evaluate(() => document.documentElement.style.setProperty('--vexbot-keyboard', '300px'));
    const box = await page.getByTestId('vexbot-panel').boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(page.viewportSize()!.height - 300);
    await page.evaluate(() => document.documentElement.style.setProperty('--vexbot-keyboard', '0px'));
    await input.fill('How soon do new clients receive a welcome pack?');
    await page.getByTestId('vexbot-send').tap();
    await expect(page.getByTestId('vexbot-assistant').last()).toContainText('two business days');
    await expect(page.getByTestId('vexbot-sources').last()).toContainText('Synthetic: Onboarding guide');
    await shot(page, 'mobile-02-client-sheet-answer');
    await page.getByLabel('Close Vexbot').tap();
    await page.getByRole('button', { name: /Messages/ }).first().tap();
    await resting(page);
    await shot(page, 'mobile-03-client-messages');
    expect(errors).toEqual([]);
  });
});
