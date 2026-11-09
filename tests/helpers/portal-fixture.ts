import { expect, type Page } from '@playwright/test';

export const ADMIN = '11111111-1111-4111-8111-111111111111';
export const CLIENT = '22222222-2222-4222-8222-222222222222';
export const THREAD = '33333333-3333-4333-8333-333333333333';

// UI contract tests use isolated network fixtures; PostgreSQL policies are tested separately.
export async function fixture(page: Page, role: 'admin' | 'client' = 'admin') {
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
  await page.route('**/api/vexbot', (route) => {
    const action = route.request().postDataJSON()?.action;
    return route.fulfill({
      json: action === 'status' ? { provider: null, voice: false } : { conversations: [] },
    });
  });
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
