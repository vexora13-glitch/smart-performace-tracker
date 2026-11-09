// Merge regression: recent dialogue must retain portal file follow-ups and source withdrawal.
// Real local Auth, PostgREST and Storage; the answer provider is deterministic and makes no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { createHandler } from '../server/vexbot/handler.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';

const env = { ...loadEnv(process.env.PORTAL_DEV_MODE || 'localtest', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL;
const local = url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);

test('merged recent context keeps file references, corrections and citation withdrawal', {
  skip: !local && 'Local Supabase is not configured (run supabase start)',
}, async (t) => {
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, authOptions);
  const browser = createClient(url, env.VITE_SUPABASE_ANON_KEY, authOptions);
  const ok = ({ data, error }) => { assert.equal(error, null); return data; };
  const tag = randomUUID();
  const email = `merge-${tag}@example.test`;
  const password = 'Synthetic-Merge-Passw0rd';
  const { user } = ok(await db.auth.admin.createUser({ email, password, email_confirm: true }));
  ok(await db.rpc('portal_provision_client', { user_id: user.id, contact: 'Merge Test', company: `Merge ${tag}`, email }));
  const { session } = ok(await browser.auth.signInWithPassword({ email, password }));
  const path = `${user.id}/${tag}/merge-context.txt`;
  const bytes = Buffer.from('The proposed coastal walkway is 2.4 km long.');
  ok(await db.storage.from('portal-private').upload(path, bytes, { contentType: 'text/plain' }));
  const file = ok(await db.from('portal_files').insert({ workspace_id: user.id, name: 'merge-context.txt', path, mime_type: 'text/plain', size_bytes: bytes.length }).select('*').single());
  // A second readable file makes the pronoun depend on the previous citation, not a one-file fallback.
  const decoyPath = `${user.id}/${tag}/unrelated.txt`;
  ok(await db.storage.from('portal-private').upload(decoyPath, Buffer.from('Unrelated notes.'), { contentType: 'text/plain' }));
  const decoy = ok(await db.from('portal_files').insert({ workspace_id: user.id, name: 'unrelated.txt', path: decoyPath, mime_type: 'text/plain', size_bytes: 16 }).select('*').single());
  const conversation = ok(await db.from('vexbot_conversations').insert({ workspace_id: user.id, user_id: user.id, title: 'Merge regression' }).select('*').single());
  t.after(async () => {
    ok(await db.from('vexbot_conversations').delete().eq('id', conversation.id));
    ok(await db.from('portal_files').delete().in('id', [file.id, decoy.id]));
    ok(await db.storage.from('portal-private').remove([path, decoyPath]));
    ok(await db.from('portal_clients').delete().eq('id', user.id));
    ok(await db.from('portal_profiles').delete().eq('id', user.id));
    ok(await db.auth.admin.deleteUser(user.id));
  });

  // All old turns are outside the hourly quota, with distinct timestamps to establish ordering.
  const start = Date.now() - 3 * 3600_000;
  const correction = 'Correction: the coastal walkway is proposed, not approved.';
  const turns = Array.from({ length: 212 }, (_, i) => ({
    id: randomUUID(), conversation_id: conversation.id,
    role: i % 2 ? 'assistant' : 'user',
    content: i === 210 ? correction : i === 211 ? 'Previous file answer to withdraw.' : `Earlier turn ${i}`,
    ...(i % 2 ? { outcome: 'answered' } : {}),
    created_at: new Date(start + i * 1000).toISOString(),
  }));
  ok(await db.from('vexbot_messages').insert(turns));
  ok(await db.from('vexbot_file_citations').insert({ message_id: turns.at(-1).id, file_id: file.id, file_name: file.name, excerpt: 'The proposed coastal walkway is 2.4 km long.' }));
  const requests = [];
  const mock = createProvider({ VEXBOT_PROVIDER: 'mock' });
  const handler = createHandler({
    getDatabase: () => db, getScanner: () => null,
    getProvider: () => ({ ...mock, async answer(input) { requests.push(input); return mock.answer(input); } }),
  });
  const call = async (body) => {
    let status = 200, json;
    const res = { setHeader() {}, status(code) { status = code; return res; }, json(value) { json = value; return res; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${session.access_token}` }, body }, res);
    assert.equal(status, 200, json?.error);
    return json;
  };

  const saved = await call({ action: 'conversation', conversation_id: conversation.id });
  assert.equal(saved.messages.length, 200);
  assert.equal(saved.messages[0].id, turns[12].id, 'history must load the latest 200, not the earliest');
  assert.equal(saved.messages.at(-1).id, turns.at(-1).id);
  const result = await call({ action: 'ask', workspace_id: user.id, conversation_id: conversation.id, question: 'Summarise it' });
  assert.equal(result.messages[1].outcome, 'answered');
  assert.match(result.messages[1].content, /2\.4 km/);
  assert.equal(result.messages[1].citations[0].file_id, file.id);
  assert.ok(requests[0].history.length > 8);
  assert.ok(requests[0].history.some((turn) => turn.content === correction));
  assert.ok(!requests[0].history.some((turn) => turn.content === 'Earlier turn 0'));
  assert.ok(requests[0].sources.some((source) => source.file_id === file.id && source.whole));

  ok(await db.from('portal_files').delete().eq('id', file.id));
  const withdrawn = await call({ action: 'conversation', conversation_id: conversation.id });
  assert.equal(withdrawn.messages.find((turn) => turn.id === turns.at(-1).id).withdrawn, true);
  assert.equal(withdrawn.messages.find((turn) => turn.id === result.messages[1].id).withdrawn, true);
  await call({ action: 'ask', workspace_id: user.id, conversation_id: conversation.id, question: 'Thanks for the clarification' });
  assert.ok(!requests.at(-1).history.some((turn) => turn.content === 'Previous file answer to withdraw.' || turn.content === result.messages[1].content));
  assert.ok(requests.at(-1).history.some((turn) => turn.content === correction));
});
