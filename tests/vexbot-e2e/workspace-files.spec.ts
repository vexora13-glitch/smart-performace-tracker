import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Acceptance: in the Test workspace, "Summarize pike point.pdf" is answered from the PDF under Shared files,
// with a citation, in text and by voice, and the voice run never opens the chat panel. Local stack only,
// synthetic PDF (scripts/vexbot-local-seed.mjs). The mock transcriber hears "Summarize pike point.pdf".
type Seed = { password: string; tess: { email: string } };
const seed = (): Seed => JSON.parse(readFileSync('artifacts/vexbot-seed.json', 'utf8'));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `artifacts/screenshots/${name}.png` });
const data = (page: Page) =>
  page.evaluate(() => ({
    ...(document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset,
  }));

async function login(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('input[name=email]').fill(seed().tess.email);
  await page.locator('input[name=password]').fill(seed().password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('vexbot-launcher')).toBeVisible();
  return errors;
}
/** Every value the robot's place and voice-mode state take, frame by frame. */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Record<string, string[]> };
    w.__seen = { place: [], talk: [] };
    const tick = () => {
      const d = (document.querySelector('[data-testid=vexbot]') as HTMLElement | null)?.dataset;
      if (d)
        for (const key of ['place', 'talk'])
          if (d[key] && !w.__seen[key].includes(d[key]!)) w.__seen[key].push(d[key]!);
      requestAnimationFrame(tick);
    };
    tick();
  });
}
const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);

test.describe.configure({ mode: 'serial' });

test('Test workspace: text answer from the shared PDF, with its citation', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop only');
  test.setTimeout(180000);
  const errors = await login(page);
  await expect(page.locator('.files-panel')).toContainText('pike point.pdf');
  // Ask about a file that is already shared, without uploading it again.
  await page.getByLabel('Ask Vexbot about pike point.pdf').click();
  await expect(page.getByTestId('vexbot-panel')).toBeVisible();
  await expect(page.getByTestId('vexbot-input')).toHaveValue('Summarize “pike point.pdf”');
  await expect(page.getByTestId('vexbot-send')).toBeEnabled();
  await page.keyboard.press('Enter');
  let answer = page.getByTestId('vexbot-assistant').last();
  await expect(answer).toHaveAttribute('data-outcome', 'answered');
  await expect(answer).toContainText('2.4 km coastal walkway');
  await expect(answer.getByTestId('vexbot-sources')).toContainText('pike point.pdf');
  await expect(answer.getByTestId('vexbot-sources')).toContainText('Shared file');

  // The exact acceptance question, in a new conversation.
  await page.getByTestId('vexbot-new').click();
  await page.getByTestId('vexbot-input').fill('Summarize `pike point.pdf`');
  await expect(page.getByTestId('vexbot-send')).toBeEnabled();
  await page.keyboard.press('Enter');
  answer = page.getByTestId('vexbot-assistant').last();
  await expect(answer).toContainText('2.4 km coastal walkway');
  await answer.locator('summary', { hasText: 'pike point.pdf' }).click();
  await expect(answer.locator('blockquote')).toContainText('Pike Point');
  await expect(answer.getByRole('button', { name: 'Open pike point.pdf' })).toBeVisible();
  await shot(page, 'files-01-text-summary-cited');

  // Another shared file, a plain text file, is read the same way.
  await page.getByTestId('vexbot-input').fill('Summarize part-one.txt');
  await expect(page.getByTestId('vexbot-send')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText('five staff members');
  expect(errors).toEqual([]);
});

test('natural proposal recognition, pricing follow-up and SOW selection through the local streaming route', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop only');
  test.setTimeout(180000);
  const errors = await login(page);
  await page.getByTestId('vexbot-launcher').click();
  await page
    .getByTestId('vexbot-input')
    .fill('Can you open the proposal here and summarize it for me?');
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/vexbot') && response.request().postDataJSON()?.action === 'ask',
  );
  await page.getByTestId('vexbot-send').click();
  expect((await response).headers()['content-type']).toContain('text/event-stream');
  await expect(page.getByTestId('vexbot-assistant')).toHaveCount(1, { timeout: 45000 });
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText('booking website', {
    timeout: 45000,
  });
  await expect(page.getByTestId('vexbot-sources').last()).toContainText('Proposal_Draft.pdf');
  await page.getByTestId('vexbot-input').fill('How much will it cost?');
  await expect(page.getByTestId('vexbot-send')).toBeEnabled();
  await page.getByTestId('vexbot-send').click();
  await expect(page.getByTestId('vexbot-assistant')).toHaveCount(2, { timeout: 45000 });
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText('42,000', {
    timeout: 45000,
  });
  await page.getByTestId('vexbot-input').fill('Summarise the SOW');
  await expect(page.getByTestId('vexbot-send')).toBeEnabled();
  await page.getByTestId('vexbot-send').click();
  await expect(page.getByTestId('vexbot-assistant')).toHaveCount(3, { timeout: 45000 });
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText('weekly training', {
    timeout: 45000,
  });
  await expect(page.getByTestId('vexbot-sources').last()).toContainText('Statement-of-Work.pdf');
  expect(errors).toEqual([]);
});

test('Test workspace: talk to the robot with the chat panel closed', async ({
  page,
  context,
  isMobile,
}) => {
  const prefix = isMobile ? 'files-mobile' : 'files';
  await context.grantPermissions(['microphone']);
  const errors = await login(page);
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset.state === 'resting',
    null,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('vexbot-talk')).toHaveText('Talk to Vexbot');
  await expect(page.getByTestId('vexbot-launcher')).toHaveText('Ask Vexbot');
  const before = await data(page);
  await shot(page, `${prefix}-02-talk-and-ask-controls`);
  await record(page);

  await page.getByTestId('vexbot-talk').click();
  await expect(page.getByTestId('vexbot-talk-state')).toContainText(/Starting|Listening/);
  await expect(page.getByTestId('vexbot-panel')).toHaveCount(0);
  await expect(page.getByTestId('vexbot-talk-state')).toContainText('Listening');
  await shot(page, `${prefix}-03-voice-listening`);

  // No typing, no Send, no play button: the fake microphone "speaks", Vexbot hears the pause, answers aloud.
  await expect(page.getByTestId('vexbot-talk-heard')).toContainText('Summarize pike point.pdf', {
    timeout: 40_000,
  });
  const reply = page.getByTestId('vexbot-talk-reply');
  await expect(reply).toContainText('2.4 km coastal walkway');
  await expect(page.getByTestId('vexbot-talk-sources')).toContainText('pike point.pdf');
  await shot(page, `${prefix}-04-voice-reply-with-source`);
  // After the spoken reply ends it listens again by itself.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __seen: Record<string, string[]> };
      const now = (document.querySelector('[data-testid=vexbot]') as HTMLElement).dataset.talk;
      return w.__seen.talk.includes('speaking') && (now === 'listening' || now === 'hearing');
    },
    null,
    { timeout: 30_000 },
  );
  const states = await seen(page);
  expect(states.talk).toEqual(
    expect.arrayContaining([
      'starting',
      'listening',
      'hearing',
      'transcribing',
      'thinking',
      'speaking',
    ]),
  );
  // The panel never opened, and the robot never moved into it.
  expect(states.place).not.toContain('panel');
  await expect(page.getByTestId('vexbot-panel')).toHaveCount(0);
  const during = await data(page);
  expect(Math.abs(Number(during.x) - Number(before.x))).toBeLessThan(40);

  await page.getByTestId('vexbot-talk-mute').click();
  await expect(page.getByTestId('vexbot-talk-state')).toContainText('Muted');
  await shot(page, `${prefix}-05-voice-muted`);
  await page.getByTestId('vexbot-talk-end').click();
  await expect(page.getByTestId('vexbot-talk-bubble')).toHaveCount(0);
  expect((await data(page)).talk).toBe('off');
  await expect(page.getByTestId('vexbot-panel')).toHaveCount(0);

  // Text chat, when the client chooses it, has the spoken conversation and its sources.
  await page.getByTestId('vexbot-launcher').click();
  await expect(page.getByTestId('vexbot-log')).toContainText('Summarize pike point.pdf');
  await expect(page.getByTestId('vexbot-assistant').last()).toContainText('2.4 km coastal walkway');
  await expect(page.getByTestId('vexbot-sources').last()).toContainText('pike point.pdf');
  await shot(page, `${prefix}-06-chat-after-voice`);
  expect(errors).toEqual([]);
});
