import { expect, test } from '@playwright/test';
import { CLIENT, THREAD, fixture } from '../helpers/portal-fixture';
import { pdf } from '../helpers/pdf.mjs';
const CONVERSATION = '55555555-5555-4555-8555-555555555555',
  NOTIFICATION = '66666666-6666-4666-8666-666666666666';
test('summary notification opens exact client conversation, marks read, shows partial transcript and preserves messaging', async ({
  page,
}) => {
  let unread = true;
  const calls: Record<string, unknown>[] = [];
  const conversation = {
    id: CONVERSATION,
    workspace_id: CLIENT,
    title: 'Proposal timeline',
    kind: 'voice',
    status: 'completed',
    created_at: '2026-11-09T21:42:00Z',
    ended_at: '2026-11-09T21:45:00Z',
    partial_transcript: true,
    summary_status: 'ready',
    summary_preview: 'Client discussed the project timeline.',
    follow_up: 'required',
    revision: 2,
    unread: true,
    summary: {
      overview: 'Client discussed the project timeline.',
      key_questions: [],
      information_provided: [],
      client_requests: [],
      outstanding_questions: [],
      follow_up_required: [],
      referenced_documents: [],
    },
  };
  const notification = {
    id: NOTIFICATION,
    workspace_id: CLIENT,
    kind: 'summary',
    title: 'New VexBot conversation summary',
    preview: conversation.summary_preview,
    conversation_id: CONVERSATION,
    thread_id: null,
    created_at: conversation.created_at,
  };
  const { errors } = await fixture(page, 'admin', (input) => {
    calls.push(input);
    if (input.action === 'overview')
      return {
        counts: { unread: unread ? 1 : 0, messages: 1, summaries: 1, follow_up: 1 },
        events: [],
        notifications: [notification],
        timezone: 'Pacific/Auckland',
      };
    if (input.action === 'notifications')
      return { notifications: [{ ...notification, unread }], counts: { unread: unread ? 1 : 0 } };
    if (input.action === 'notification_read' || input.action === 'mark_all_read') {
      unread = false;
      return { saved: true };
    }
    if (input.action === 'conversation')
      return {
        conversation,
        author: 'Alice',
        messages: [
          {
            id: 'message-one',
            role: 'user',
            content: 'Please clarify the timeline.',
            created_at: conversation.created_at,
            medium: 'voice',
            attachments: [],
          },
        ],
      };
    if (input.action === 'conversations') return { conversations: [conversation] };
    return { saved: true };
  });
  await page.getByRole('button', { name: 'Admin notifications, 1 unread' }).click();
  await expect(page.getByRole('dialog', { name: /Notifications/ })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /New VexBot conversation summary/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Proposal timeline', exact: true })).toBeVisible();
  await expect(
    page.getByText('Partially transcribed voice conversation.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Please clarify the timeline.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/insights/conversation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'artifacts/insights/conversation-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('button', { name: 'Admin notifications, 0 unread' })).toBeVisible();
  expect(
    calls.some(
      (c) =>
        c.action === 'conversation' &&
        c.workspace_id === CLIENT &&
        c.conversation_id === CONVERSATION,
    ),
  ).toBeTruthy();
  await page
    .getByRole('navigation', { name: 'Client administration profile' })
    .getByRole('button', { name: 'Messages', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /Website launch/ })).toBeVisible();
  await page.evaluate(
    ({ CLIENT, THREAD }) => {
      location.hash = `client=${CLIENT}&tab=messages&thread=${THREAD}&message=44444444-4444-4444-8444-444444444444`;
    },
    { CLIENT, THREAD },
  );
  await expect(page.getByText('When can we review the launch?', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Dashboard', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Client activity & follow-up' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('activity filters use administrator timezone and clients retain privacy disclosure without admin controls', async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  await fixture(page, 'admin', (input) => {
    calls.push(input);
    if (input.action === 'activity')
      return {
        events: [
          {
            id: 'e',
            workspace_id: CLIENT,
            actor_id: CLIENT,
            client_name: 'Alice',
            action: 'document_downloaded',
            target_name: 'Proposal.pdf',
            created_at: '2026-11-09T21:42:00Z',
            session_id: 'session-one',
            metadata: { document_category: 'proposal' },
          },
        ],
      };
    return {
      counts: { unread: 0, messages: 0, summaries: 0, follow_up: 0 },
      notifications: [],
      events: [],
      timezone: 'Pacific/Auckland',
    };
  });
  await page.evaluate((CLIENT) => {
    location.hash = `client=${CLIENT}&tab=activity`;
  }, CLIENT);
  await expect(page.getByText('Proposal.pdf', { exact: false }).first()).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill('2026-11-10');
  await expect
    .poll(() => calls.filter((c) => c.action === 'activity').at(-1)?.from)
    .toBe('2026-11-09T11:00:00.000Z');
  await page.getByLabel('From', { exact: true }).fill('2026-09-27');
  await page.getByLabel('Through', { exact: true }).fill('2026-09-27');
  await expect
    .poll(() => calls.filter((c) => c.action === 'activity').at(-1)?.from)
    .toBe('2026-09-26T12:00:00.000Z');
  await expect
    .poll(() => calls.filter((c) => c.action === 'activity').at(-1)?.to)
    .toBe('2026-09-27T11:00:00.000Z');
  await page.screenshot({ path: 'artifacts/insights/activity-desktop.png', fullPage: true });
});

test('client telemetry outage does not prevent workspace or VexBot access', async ({ page }) => {
  const { errors } = await fixture(page, 'client');
  await page.route('**/api/insights', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }),
  );
  await expect(
    page.getByText('Relevant portal activity and VexBot text conversations', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Admin notifications/ })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'VexBot', exact: true })
    .click();
  await expect(page.getByTestId('vexbot-input')).toBeVisible();
  expect(errors).toEqual([]);
});

test('private text and PDF previews reuse storage access and record the correct file', async ({
  page,
}) => {
  const events: Record<string, unknown>[] = [];
  const { state, errors } = await fixture(page, 'client', (input) => {
    if (input.action === 'event') events.push(input);
    return { recorded: true };
  });
  const textId = '77777777-7777-4777-8777-777777777777',
    pdfId = '88888888-8888-4888-8888-888888888888';
  state.portal_files.push(
    {
      id: textId,
      workspace_id: CLIENT,
      name: 'Proposal notes.txt',
      path: `${CLIENT}/notes.txt`,
      mime_type: 'text/plain',
      size_bytes: 30,
      created_at: '2026-11-10T00:00:00Z',
    },
    {
      id: pdfId,
      workspace_id: CLIENT,
      name: 'Statement of work.pdf',
      path: `${CLIENT}/statement.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 600,
      created_at: '2026-11-10T00:00:00Z',
    },
  );
  await page.route('**/storage/v1/object/**', (route) =>
    route.fulfill(
      route.request().url().includes('statement.pdf')
        ? { body: pdf([['The weekly training plan.']]), contentType: 'application/pdf' }
        : { body: 'Please review these proposal notes.', contentType: 'text/plain' },
    ),
  );
  await page.getByRole('button', { name: 'Refresh portal' }).click();
  await page.getByRole('button', { name: 'Preview Proposal notes.txt', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Please review these proposal notes.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close document preview' }).click();
  await page.getByRole('button', { name: 'Preview Statement of work.pdf', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.document-preview canvas')
        .evaluate((canvas: HTMLCanvasElement) => canvas.width),
    )
    .toBeGreaterThan(100);
  await page.getByText('Page text', { exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('The weekly training plan.', { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      events.some(
        (e) => e.event === 'document_previewed' && e.file_id === pdfId && e.workspace_id === CLIENT,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('notification polling recovers updates without a Realtime connection', async ({ page }) => {
  test.setTimeout(45000);
  let unread = 0;
  await fixture(page, 'admin', () => ({
    counts: { unread, messages: 0, summaries: 0, follow_up: 0 },
    events: [],
    notifications: [],
    timezone: 'Pacific/Auckland',
  }));
  await expect(page.getByRole('button', { name: 'Admin notifications, 0 unread' })).toBeVisible();
  unread = 1;
  // Fixture Supabase has no Realtime server. The visible-page polling path must update the badge.
  await expect(page.getByRole('button', { name: 'Admin notifications, 1 unread' })).toBeVisible({
    timeout: 25000,
  });
});
