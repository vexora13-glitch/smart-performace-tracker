import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/clients.mjs';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
function fixture(role = 'admin') {
  const calls = [];
  const db = {
    storage: {
      from: (bucket) => ({
        list: async (prefix, options) => {
          calls.push(['list', bucket, prefix, options.offset]);
          return { data: [], error: null };
        },
        remove: async (paths) => {
          calls.push(['remove', bucket, paths]);
          return { data: [], error: null };
        },
      }),
    },
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
        delete() {
          return {
            eq: async (_column, value) => {
              calls.push(['delete', table, value]);
              return { data: null, error: null };
            },
          };
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

test('deletion requires an administrator, explicit confirmation and valid workspace IDs', async () => {
  const client = fixture('client');
  assert.equal(
    (await client.request('DELETE', { ids: [CLIENT], confirm: 'DELETE' })).statusCode,
    403,
  );
  assert.equal(
    (await client.request('DELETE', { ids: [CLIENT], confirm: 'DELETE' }, '')).statusCode,
    401,
  );
  assert.deepEqual(client.calls, []);
  const f = fixture();
  for (const body of [
    { ids: [CLIENT] },
    { ids: [], confirm: 'DELETE' },
    { ids: ['invalid'], confirm: 'DELETE' },
  ])
    assert.equal((await f.request('DELETE', body)).statusCode, 400);
  assert.deepEqual(f.calls, []);
  f.db.rpc = async () => ({ error: { code: '22023' } });
  assert.equal((await f.request('DELETE', { ids: [ADMIN], confirm: 'DELETE' })).statusCode, 400);
});

test('deletion revokes access before Storage cleanup and removes Auth only after database cleanup', async () => {
  const f = fixture();
  const response = await f.request('DELETE', {
    ids: [CLIENT, CLIENT.toUpperCase()],
    confirm: 'DELETE',
  });
  assert.deepEqual(response.body, { deleted: [CLIENT], failed: [] });
  assert.deepEqual(
    f.calls.map((call) => call[0]),
    [
      'portal_begin_client_deletion',
      'list',
      'list',
      'portal_finish_client_deletion',
      'deleteUser',
      'delete',
    ],
  );
  assert.deepEqual(f.calls[0][1], { client_ids: [CLIENT] });
});

test('deletion includes nested, orphaned and paginated objects in both private buckets', async () => {
  const f = fixture();
  f.db.storage.from = (bucket) => ({
    list: async (prefix, { offset }) => {
      const files =
        prefix === CLIENT
          ? [
              { id: null, name: 'nested' },
              ...Array.from({ length: 104 }, (_, i) => ({ id: `${i}`, name: `file-${i}` })),
            ]
          : [{ id: 'nested-file', name: 'orphan.txt' }];
      return { data: files.slice(offset, offset + 100), error: null };
    },
    remove: async (paths) => {
      f.calls.push(['remove', bucket, paths]);
      return { error: null };
    },
  });
  assert.deepEqual((await f.request('DELETE', { ids: [CLIENT], confirm: 'DELETE' })).body, {
    deleted: [CLIENT],
    failed: [],
  });
  for (const bucket of ['portal-private', 'vexbot-private']) {
    const paths = f.calls
      .filter((call) => call[0] === 'remove' && call[1] === bucket)
      .flatMap((call) => call[2]);
    assert.equal(new Set(paths).size, 105);
    assert(paths.includes(`${CLIENT}/nested/orphan.txt`));
    assert(paths.every((path) => path.startsWith(`${CLIENT}/`)));
  }
});

test('storage failures retain database records and Auth for retry, while other selected clients finish', async () => {
  const f = fixture();
  const other = '33333333-3333-4333-8333-333333333333';
  f.db.storage.from = () => ({
    list: async (prefix) => ({
      data: [],
      error: prefix === CLIENT ? new Error('storage offline') : null,
    }),
  });
  const response = await f.request('DELETE', { ids: [CLIENT, other], confirm: 'DELETE' });
  assert.deepEqual(response.body, { deleted: [other], failed: [CLIENT] });
  assert(!f.calls.some((call) => call[0] === 'deleteUser' && call[1] === CLIENT));
  assert(
    !f.calls.some(
      (call) => call[0] === 'portal_finish_client_deletion' && call[1].client === CLIENT,
    ),
  );
});

test('Auth failures keep the deletion job; a missing Auth account can be retried safely', async () => {
  const f = fixture();
  f.db.auth.admin.deleteUser = async () => ({ error: { status: 503 } });
  assert.deepEqual((await f.request('DELETE', { ids: [CLIENT], confirm: 'DELETE' })).body, {
    deleted: [],
    failed: [CLIENT],
  });
  assert(!f.calls.some((call) => call[0] === 'delete'));
  f.db.auth.admin.deleteUser = async () => ({ error: { status: 404 } });
  assert.deepEqual((await f.request('DELETE', { ids: [CLIENT], confirm: 'DELETE' })).body, {
    deleted: [CLIENT],
    failed: [],
  });
});
