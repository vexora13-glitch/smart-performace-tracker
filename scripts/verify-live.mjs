import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import clientsHandler from '../api/clients.mjs';
import { loadCredential, saveCredential } from './local-credentials.mjs';

const url = process.env.VITE_SUPABASE_URL;
if (url !== 'https://ccxkaqbajugimmtsztif.supabase.co') throw new Error('Unexpected test project');
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = () =>
  createClient(url, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = userClient();
process.env.PORTAL_ADMIN_INITIAL_PASSWORD ||= loadCredential('portal-admin').password;
const checked = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const session = checked(
  await admin.auth.signInWithPassword({
    email: 'allan@vexoradigital.com',
    password: process.env.PORTAL_ADMIN_INITIAL_PASSWORD,
  }),
).session;
const adminId = session.user.id;
const run = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const prefix = `portal-validation-${run}`;
const results = [];
const accounts = [];
async function api(body, method = 'POST', token = session.access_token) {
  const res = {
    statusCode: 0,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await clientsHandler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  assert(
    res.statusCode >= 200 && res.statusCode < 300,
    JSON.stringify({ status: res.statusCode, ...res.body }),
  );
  return res.body;
}
async function step(name, action) {
  await action();
  results.push(name);
  console.log(`PASS ${name}`);
}
let alice, bob, thread, path;
await step('administrator login and authoritative role', async () => {
  assert.equal(
    checked(await admin.from('portal_profiles').select('role').eq('id', adminId).single()).role,
    'admin',
  );
});
for (const label of ['alice', 'bob']) {
  const password = `Vx9!${randomBytes(20).toString('base64url')}`;
  const email = `${prefix}-${label}@example.com`;
  const account = await api({
    company: `Validation ${label} ${run}`,
    display_name: `Validation ${label}`,
    email,
    password,
  });
  const db = userClient();
  const auth = checked(await db.auth.signInWithPassword({ email, password }));
  accounts.push({ id: account.id, email, password, token: auth.session.access_token, db });
}
[alice, bob] = accounts;
await step('administrator-issued client accounts and private workspaces', async () => {
  assert.equal(checked(await alice.db.from('portal_clients').select('*')).length, 1);
  assert.equal(checked(await bob.db.from('portal_clients').select('*'))[0].id, bob.id);
});
await step('cross-client and role-escalation requests denied', async () => {
  assert.equal(
    checked(await bob.db.from('portal_clients').select('*').eq('id', alice.id)).length,
    0,
  );
  assert(
    (await alice.db.from('portal_profiles').update({ role: 'admin' }).eq('id', alice.id)).error,
  );
  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  await clientsHandler(
    { method: 'POST', headers: { authorization: `Bearer ${alice.token}` }, body: {} },
    res,
  );
  assert.equal(res.code, 403);
});
await step('published update is visible only in its client workspace', async () => {
  checked(
    await admin.from('portal_announcements').insert({
      workspace_id: alice.id,
      title: `Validation update ${run}`,
      body: 'Private validation update.',
      author_id: adminId,
    }),
  );
  assert.equal(checked(await alice.db.from('portal_announcements').select('*')).length, 1);
  assert.equal(checked(await bob.db.from('portal_announcements').select('*')).length, 0);
});
await step('private document upload, download and cross-client denial', async () => {
  path = `${alice.id}/${prefix}/validation.txt`;
  const text = 'Vexora portal private storage validation';
  checked(
    await admin.storage
      .from('portal-private')
      .upload(path, new Blob([text], { type: 'text/plain' }), { contentType: 'text/plain' }),
  );
  checked(
    await admin.from('portal_files').insert({
      workspace_id: alice.id,
      path,
      name: 'validation.txt',
      mime_type: 'text/plain',
      size_bytes: Buffer.byteLength(text),
    }),
  );
  assert.equal(
    await checked(await alice.db.storage.from('portal-private').download(path)).text(),
    text,
  );
  assert((await bob.db.storage.from('portal-private').download(path)).error);
  assert(
    (
      await alice.db.storage
        .from('portal-private')
        .upload(`${alice.id}/forbidden.txt`, new Blob(['no'], { type: 'text/plain' }))
    ).error,
  );
});
await step('two-way messages, durable email job and read receipts', async () => {
  thread = checked(
    await alice.db.rpc('portal_start_conversation', {
      workspace: alice.id,
      title: `Validation question ${run}`,
      body: 'Can we review this document?',
    }),
  )[0].conversation_id;
  checked(
    await admin.from('portal_messages').insert({
      conversation_id: thread,
      author_id: adminId,
      body: 'Yes, it is ready for review.',
    }),
  );
  assert.equal(
    checked(await alice.db.from('portal_messages').select('*').eq('conversation_id', thread))
      .length,
    2,
  );
  assert.equal(
    checked(await bob.db.from('portal_messages').select('*').eq('conversation_id', thread)).length,
    0,
  );
  checked(await alice.db.rpc('portal_mark_read', { conversation: thread }));
  checked(await admin.rpc('portal_mark_read', { conversation: thread }));
  assert.equal(
    checked(await alice.db.from('portal_reads').select('*').eq('conversation_id', thread)).length,
    2,
  );
  assert.equal(
    checked(
      await service
        .from('portal_email_jobs')
        .select('id')
        .in(
          'message_id',
          checked(
            await admin.from('portal_messages').select('id').eq('conversation_id', thread),
          ).map((m) => m.id),
        ),
    ).length,
    1,
  );
});
await step('archived conversations reject replies and can reopen', async () => {
  checked(
    await admin
      .from('portal_conversations')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', thread),
  );
  assert(
    (
      await alice.db
        .from('portal_messages')
        .insert({ conversation_id: thread, author_id: alice.id, body: 'Should be denied' })
    ).error,
  );
  assert.equal(
    checked(await alice.db.from('portal_messages').select('*').eq('conversation_id', thread))
      .length,
    2,
  );
  checked(await admin.from('portal_conversations').update({ archived_at: null }).eq('id', thread));
});
await step('disabled client access and managed credential recovery', async () => {
  await api({ id: alice.id, action: 'status', active: false }, 'PATCH');
  assert.equal(checked(await alice.db.from('portal_clients').select('*')).length, 0);
  assert((await alice.db.storage.from('portal-private').download(path)).error);
  await api({ id: alice.id, action: 'status', active: true }, 'PATCH');
  const nextPassword = `Vx9!${randomBytes(20).toString('base64url')}`;
  await api({ id: alice.id, action: 'password', password: nextPassword }, 'PATCH');
  assert.equal(checked(await alice.db.from('portal_clients').select('*')).length, 0);
  assert(
    (await userClient().auth.signInWithPassword({ email: alice.email, password: alice.password }))
      .error,
  );
  alice.password = nextPassword;
});
await step('client and administrator sign out', async () => {
  checked(await alice.db.auth.signOut());
  checked(await bob.db.auth.signOut());
  checked(await admin.auth.signOut());
  assert.equal((await admin.auth.getSession()).data.session, null);
});
// Retain the validation records for review. No remote rows or objects are deleted.
saveCredential('live-accounts', {
  run,
  accounts: accounts.map(({ id, email, password }) => ({ id, email, password })),
  thread,
  path,
});
writeFileSync(
  'artifacts/live-results.json',
  JSON.stringify(
    {
      project: 'ccxkaqbajugimmtsztif',
      run,
      passed: results,
      retainedTestAccounts: accounts.map(({ id, email }) => ({ id, email })),
      thread,
      path,
    },
    null,
    2,
  ),
);
console.log(
  'Hosted workflow validation finished. Validation records retained; credentials saved only to ignored local artifacts.',
);
