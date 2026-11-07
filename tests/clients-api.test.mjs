import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/clients.mjs';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
function fixture(role = 'admin') {
  const calls = [];
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: { id: ADMIN, email_confirmed_at: '2026-01-01' } },
        error: null,
      }),
      admin: {
        createUser: async (input) => {
          calls.push(['createUser', input]);
          return { data: { user: { id: CLIENT } }, error: null };
        },
        deleteUser: async (id) => {
          calls.push(['deleteUser', id]);
          return { data: {}, error: null };
        },
        updateUserById: async (id, input) => {
          calls.push(['password', id, input]);
          return { data: {}, error: null };
        },
      },
    },
    from(table) {
      let selectedId;
      return {
        select() {
          return this;
        },
        eq(_column, value) {
          selectedId = value;
          return this;
        },
        single: async () => ({
          data:
            selectedId === ADMIN
              ? { id: ADMIN, role, active: true }
              : { id: CLIENT, role: 'client', active: true },
          error: null,
        }),
        update(value) {
          calls.push(['update', table, value]);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
    rpc: async (name, input) => {
      calls.push([name, input]);
      return { data: null, error: null };
    },
  };
  const handler = createHandler(() => db);
  async function request(method, body, authorization = 'Bearer test') {
    const response = {
      statusCode: 0,
      body: null,
      setHeader() {},
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
    };
    await handler({ method, headers: { authorization }, body }, response);
    return response;
  }
  return { request, calls, db };
}
const input = {
  email: 'alice@example.test',
  display_name: 'Alice',
  company: 'Studio',
  password: 'SecurePass123!',
};
test('client provisioning uses Auth admin plus atomic DB RPC and never returns password', async () => {
  const f = fixture();
  const response = await f.request('POST', input);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, { id: CLIENT });
  assert.equal(f.calls[0][0], 'createUser');
  assert.equal(f.calls[1][0], 'portal_provision_client');
  assert(!JSON.stringify(response.body).includes(input.password));
});
test('client and anonymous users cannot create accounts', async () => {
  const f = fixture('client');
  assert.equal((await f.request('POST', input)).statusCode, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('POST', input, '')).statusCode, 401);
});
test('failed provisioning compensates only the newly created Auth account', async () => {
  const f = fixture();
  f.db.rpc = async () => ({ data: null, error: new Error('database failed') });
  assert.equal((await f.request('POST', input)).statusCode, 500);
  assert.deepEqual(f.calls[1], ['deleteUser', CLIENT]);
});
test('administrator can update details, disable access and replace client password', async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request('PATCH', {
        id: CLIENT,
        action: 'details',
        company: 'Studio 2',
        display_name: 'Alice 2',
      })
    ).statusCode,
    200,
  );
  assert.equal(f.calls[0][0], 'portal_update_client');
  assert.equal(
    (await f.request('PATCH', { id: CLIENT, action: 'status', active: false })).statusCode,
    200,
  );
  assert.equal(f.calls[1][2].active, false);
  assert(f.calls[1][2].sessions_invalid_before);
  assert.equal(
    (await f.request('PATCH', { id: CLIENT, action: 'password', password: 'NewSecurePass123!' }))
      .statusCode,
    200,
  );
  assert.equal(f.calls.at(-1)[0], 'password');
  assert.equal(
    (await f.request('PATCH', { id: ADMIN, action: 'password', password: 'NewSecurePass123!' }))
      .statusCode,
    400,
  );
});
test('invalid requests are rejected before account creation', async () => {
  const f = fixture();
  assert.equal((await f.request('GET', {})).statusCode, 405);
  assert.equal((await f.request('POST', { ...input, password: 'weak' })).statusCode, 400);
  assert.equal(f.calls.length, 0);
});
