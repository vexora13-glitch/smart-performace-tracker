import { expect, test, type Page } from '@playwright/test';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';

// UI contract tests use isolated network fixtures; PostgreSQL policies are tested separately.
async function fixture(page: Page, role: 'admin' | 'client' = 'admin') {
  const userId = role === 'admin' ? ADMIN : CLIENT;
  const profiles = [
    { id: ADMIN, display_name: 'Allan', role: 'admin', active: true },
    { id: CLIENT, display_name: 'Alice', role: 'client', active: true },
  ];
  const state: Record<string, Record<string, unknown>[]> = {
    portal_profiles: role === 'admin' ? profiles : [profiles[1]],
    portal_clients: [
      {
        id: CLIENT,
        company: 'Acme Studio',
        email: 'alice@example.test',
        created_at: '2026-11-01T09:00:00Z',
      },
    ],
    portal_conversations: [
      {
        id: THREAD,
        workspace_id: CLIENT,
        subject: 'Website launch',
        archived_at: null,
        created_at: '2026-11-02T09:00:00Z',
      },
    ],
    portal_messages: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        conversation_id: THREAD,
        author_id: CLIENT,
        body: 'When can we review the launch?',
        created_at: '2026-11-02T09:01:00Z',
      },
    ],
    portal_reads: [],
    portal_announcements: [],
    portal_files: [],
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().url().includes('/logout')) return route.fulfill({ status: 204 });
    const request = route.request().postDataJSON();
    if (request?.password === 'WrongPassword123!')
      return route.fulfill({ status: 400, json: { message: 'Invalid login credentials' } });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp })).toString('base64url')}.test`;
    return route.fulfill({
      json: {
        access_token: token,
        refresh_token: 'fixture',
        expires_in: 3600,
        expires_at: exp,
        token_type: 'bearer',
        user: {
          id: userId,
          email: role === 'admin' ? 'allan@vexoradigital.com' : 'alice@example.test',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-11-01T09:00:00Z',
        },
      },
    });
  });
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1)!;
    const method = route.request().method();
    if (url.pathname.includes('/rpc/')) {
      if (table === 'portal_start_conversation') {
        const input = route.request().postDataJSON();
        const cid = crypto.randomUUID();
        const mid = crypto.randomUUID();
        state.portal_conversations.unshift({
          id: cid,
          workspace_id: input.workspace,
          subject: input.title,
          archived_at: null,
          created_at: new Date().toISOString(),
        });
        state.portal_messages.push({
          id: mid,
          conversation_id: cid,
          author_id: userId,
          body: input.body,
          created_at: new Date().toISOString(),
        });
        return route.fulfill({ json: [{ conversation_id: cid, message_id: mid }] });
      }
      return route.fulfill({ json: null });
    }
    if (method === 'GET') {
      let rows = state[table] || [];
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id) rows = rows.filter((row) => row.id === id);
      return route.fulfill({
        json: route.request().headers().accept?.includes('vnd.pgrst.object') ? rows[0] : rows,
      });
    }
    const input = route.request().postDataJSON();
    if (method === 'POST') {
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...input };
      state[table].push(row);
      return route.fulfill({
        status: 201,
        json: route.request().headers().accept?.includes('vnd.pgrst.object') ? row : [row],
      });
    }
    if (method === 'PATCH') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      state[table] = state[table].map((row) => (row.id === id ? { ...row, ...input } : row));
    }
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/clients', (route) =>
    route.fulfill({ status: 201, json: { id: CLIENT } }),
  );
  await page.route('**/api/notifications', (route) =>
    route.fulfill({ status: 503, json: { error: 'Email not configured' } }),
  );
  await page.route('**/storage/v1/**', (route) =>
    route.fulfill({
      json: {
        Key: 'portal-private/test',
        signedURL: '/object/sign/portal-private/test?token=test',
      },
    }),
  );
  await page.goto('/');
  await page
    .getByLabel('Email address')
    .fill(role === 'admin' ? 'allan@vexoradigital.com' : 'alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('SecurePassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  return { state, errors };
}

test('login is responsive, hides passwords and handles rejected credentials', async ({ page }) => {
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, json: { message: 'Invalid login credentials' } }),
  );
  await page.goto('/');
  await expect(page).toHaveTitle('Vexora Client Portal');
  await page.getByLabel('Email address').fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword123!');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign in');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/login-mobile.png', fullPage: true });
});
test('admin manages clients, publishes an update and uploads a private document', async ({
  page,
}) => {
  const { state, errors } = await fixture(page);
  await expect(page.getByRole('heading', { name: 'Welcome back, Allan.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/admin-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company', { exact: true }).fill('New Studio');
  await dialog.getByLabel('Contact name').fill('New Contact');
  await dialog.getByLabel('Email address').fill('new@example.test');
  await dialog.getByLabel('Initial password').fill('SecurePassword123!');
  const request = page.waitForRequest('**/api/clients');
  await dialog.getByRole('button', { name: 'Create client & workspace' }).click();
  expect((await request).postDataJSON().company).toBe('New Studio');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /Acme Studio alice/ }).click();
  await page.getByRole('button', { name: 'Publish update', exact: true }).click();
  await page.getByLabel('Update title').fill('Ready for review');
  await page.getByLabel('Message', { exact: true }).fill('Your launch documents are ready.');
  await page.getByRole('button', { name: 'Publish to client' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible();
  await page
    .getByLabel('Upload client file')
    .setInputFiles({
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF test'),
    });
  await expect(page.getByText('brief.pdf', { exact: true })).toBeVisible();
  expect(state.portal_files[0].workspace_id).toBe(CLIENT);
  expect(state.portal_announcements[0].author_id).toBe(ADMIN);
  expect(errors).toEqual([]);
});
test('admin reads, replies, archives and reopens a conversation', async ({ page }) => {
  const { state, errors } = await fixture(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Messages/ })
    .click();
  await page.getByRole('button', { name: /Website launch Acme Studio/ }).click();
  await expect(page.getByText('When can we review the launch?')).toBeVisible();
  await page.getByLabel('Your reply').fill('Let’s review tomorrow.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Let’s review tomorrow.')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('This conversation is archived.', { exact: false })).toBeVisible();
  expect(state.portal_conversations[0].archived_at).toBeTruthy();
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.getByLabel('Your reply')).toBeVisible();
  expect(errors).toEqual([]);
});
test('client has its own workspace, sends questions, and signs out', async ({ page }) => {
  const { state, errors } = await fixture(page, 'client');
  await expect(page.getByRole('heading', { name: 'Acme Studio.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage client' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Clients' })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Upload client file')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open messages' }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).first().click();
  await page.getByLabel('Subject').fill('A new idea');
  await page.getByLabel('Your message', { exact: true }).fill('Can we add a landing page?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Can we add a landing page?', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Message sent');
  expect(state.portal_conversations[0].workspace_id).toBe(CLIENT);
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/client-messages-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace awaits.' })).toBeVisible();
  expect(errors).toEqual([]);
});
