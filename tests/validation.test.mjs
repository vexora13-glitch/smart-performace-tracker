import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientInput, password, id } from '../server/validation.mjs';
import { authenticate, respondError } from '../server/runtime.mjs';

test('credential input is bounded and passwords are never returned in API errors', () => {
  assert.throws(() => password('short'), /12–128/);
  assert.throws(() => password('a'.repeat(130)), /12–128/);
  assert.equal(password('SecurePass123!'), 'SecurePass123!');
  assert.throws(() => id('../other-client'));
  assert.throws(
    () =>
      clientInput({
        company: 'Acme',
        display_name: 'Alice',
        email: 'bad',
        password: 'SecurePass123!',
      }),
    /email/,
  );
  assert.equal(
    clientInput({
      company: ' Acme ',
      display_name: ' Alice ',
      email: 'ALICE@EXAMPLE.TEST',
      password: 'SecurePass123!',
    }).email,
    'alice@example.test',
  );
  let value;
  const res = {
    status() {
      return this;
    },
    json(input) {
      value = input;
    },
  };
  respondError(res, new Error('SECRET_PROVIDER_KEY'));
  assert(!JSON.stringify(value).includes('SECRET_PROVIDER_KEY'));
});
test('server verifies token and authoritative active role for every privileged request', async () => {
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'user', email_confirmed_at: '2026-01-01' } },
        error: null,
      }),
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: { id: 'user', role: 'client', active: true }, error: null }),
      };
    },
  };
  await assert.rejects(authenticate({ headers: {} }, db, true), /Sign in/);
  await assert.rejects(
    authenticate({ headers: { authorization: 'Bearer verified' } }, db, true),
    /Access denied/,
  );
  assert.equal(
    (await authenticate({ headers: { authorization: 'Bearer verified' } }, db)).profile.role,
    'client',
  );
  db.auth.getUser = async () => ({ data: { user: null }, error: new Error('bad token') });
  await assert.rejects(
    authenticate({ headers: { authorization: 'Bearer forged' } }, db),
    /expired/,
  );
});
