import test from 'node:test';
import assert from 'node:assert/strict';
import { createInsightsHandler } from '../api/insights.mjs';

const workspace = '22222222-2222-4222-8222-222222222222';

// Simulate the actual hosted failure after successful Auth/profile/workspace checks.
async function request(action, error, role = 'admin') {
  const queried = [];
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin', email_confirmed_at: '2026-01-01' } } }),
    },
    from(table) {
      queried.push(table);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        single: async () => ({ data: { role, active: true } }),
        maybeSingle: async () => ({ data: { id: workspace } }),
        range: async () => ({ data: null, error }),
      };
      return query;
    },
  };
  let status = 200,
    body;
  const res = {
    setHeader() {},
    status(value) {
      status = value;
      return res;
    },
    json(value) {
      body = value;
      return res;
    },
  };
  await createInsightsHandler(() => db)(
    {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: { action, workspace_id: workspace },
    },
    res,
  );
  return { status, body, queried };
}

test('insights reports missing activity tables and conversation columns as required setup', async () => {
  for (const [action, code] of [
    ['activity', 'PGRST205'],
    ['activity', '42P01'],
    ['conversations', '42703'],
    ['conversations', 'PGRST204'],
  ]) {
    const result = await request(action, { code, message: 'PRIVATE_DATABASE_DETAILS' });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /need a database update/);
    assert.ok(!JSON.stringify(result.body).includes('PRIVATE_DATABASE_DETAILS'));
  }
});

test('insights keeps unexpected database failures private and denies clients before schema queries', async () => {
  const error = { code: 'XX000', message: 'PRIVATE_DATABASE_DETAILS' };
  const result = await request('activity', error);
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'The request could not be completed. Please try again.');
  const denied = await request('conversations', error, 'client');
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.queried, ['portal_profiles']);
});
