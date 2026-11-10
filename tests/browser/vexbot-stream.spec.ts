import { expect, test } from '@playwright/test';
import { CLIENT, fixture } from '../helpers/portal-fixture';
import { writeFile } from 'node:fs/promises';

test('an authoritative saved answer completes without waiting for a stalled HTTP EOF', async ({ page }) => {
  await fixture(page, 'client');
  const result = await page.evaluate(async () => {
    const original = window.fetch;
    let cancelled = false;
    window.fetch = async (input, init) => {
      if (input !== '/api/vexbot') return original(input, init);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: answer\ndata: {"conversation":{"id":"saved"},"messages":[]}\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
      const { streamQuestion } = await import('/src/vexbot/chat-stream.ts' as string);
      const answer = await streamQuestion({ action: 'ask' }, new AbortController().signal, () => {});
      return { answer, cancelled };
    } finally { window.fetch = original; }
  });
  expect(result.answer.conversation.id).toBe('saved');
  expect(result.cancelled).toBe(true);
});

test('streaming chat displays the user immediately, handles interrupted replies and cancels requests', async ({ page }) => {
  const { errors } = await fixture(page, 'client');
  await page.route('**/api/vexbot', route => {
    const input = route.request().postDataJSON();
    if (input.action === 'status') return route.fulfill({ json: { provider: 'fixture', voice: false } });
    if (input.action !== 'ask') return route.fulfill({ json: { conversations: [] } });
    return route.fulfill({ contentType: 'text/event-stream', body: 'event: status\ndata: {"stage":"processing"}\n\nevent: delta\ndata: {"text":"Verified partial answer"}\n\n' });
  });
  await page.getByTestId('vexbot-launcher').click();
  await page.getByTestId('vexbot-input').fill('Summarise the proposal');
  const rendering = await page.evaluate(async () => {
    const started = performance.now();
    return new Promise<{ started: number; user_display: number; feedback: number }>(resolve => {
      const observer = new MutationObserver(() => {
        const user = document.querySelector('[data-testid="vexbot-log"]')?.textContent?.includes('Summarise the proposal');
        const processing = document.querySelector('.vexbot-message.thinking');
        if (user && processing) { observer.disconnect(); resolve({ started, user_display: performance.now() - started, feedback: performance.now() - started }); }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      (document.querySelector('[data-testid="vexbot-send"]') as HTMLButtonElement).click();
    });
  });
  await expect(page.getByTestId('vexbot-status')).toContainText('interrupted');
  const network = await page.evaluate(start => {
    const request = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find(entry => entry.name.endsWith('/api/vexbot') && entry.startTime >= start);
    return request ? { api_initiation: request.startTime - start, first_byte: request.responseStart - start, network_complete: request.responseEnd - start } : {};
  }, rendering.started);
  await writeFile('artifacts/vexbot-browser-render.json', JSON.stringify({ condition: 'single local fixture browser sample; DOM visibility and resource timing; not painted pixels or production percentiles', user_display: rendering.user_display, feedback: rendering.feedback, ...network }, null, 2));
  await expect(page.getByTestId('vexbot-input')).toHaveValue('Summarise the proposal');
  await expect(page.getByText('Verified partial answer')).toHaveCount(0);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/vexbot', async route => {
    if (route.request().postDataJSON()?.action !== 'ask') return route.fallback();
    await pending;
    await route.abort().catch(() => {});
  });
  await page.getByTestId('vexbot-send').click();
  await expect(page.getByTestId('vexbot-panel')).toContainText('Summarise the proposal');
  await page.getByRole('button', { name: 'Stop response' }).click();
  release();
  await expect(page.getByTestId('vexbot-status')).toContainText('Reply stopped');
  // Complete a later request successfully: no stale partial or cancelled response may appear.
  await page.unroute('**/api/vexbot');
  await page.route('**/api/vexbot', route => {
    const input = route.request().postDataJSON();
    const result = { conversation: { id: 'conversation', title: 'Proposal', workspace_id: CLIENT }, messages: [
      { id: 'u', role: 'user', content: input.question }, { id: 'a', role: 'assistant', outcome: 'answered', content: 'The proposal includes a booking website.', citations: [{ id: 'p', kind: 'file', title: 'Proposal.pdf', excerpt: 'Booking website.' }] },
    ] };
    return route.fulfill(input.action === 'ask' ? { contentType: 'text/event-stream', body: `event: result\ndata: ${JSON.stringify(result)}\n\n` } : { json: { conversations: [] } });
  });
  await page.getByTestId('vexbot-input').fill('What are the deliverables?');
  await page.getByTestId('vexbot-send').click();
  await expect(page.getByTestId('vexbot-assistant')).toContainText('booking website');
  await expect(page.getByTestId('vexbot-sources')).toContainText('Proposal.pdf');
  expect(errors).toEqual([]);
});
