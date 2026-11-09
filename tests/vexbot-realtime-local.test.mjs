import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { voiceContext } from '../server/vexbot/handler.mjs';
import { admit } from '../server/vexbot/realtime.mjs';

const env = { ...loadEnv('localtest', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL;
const local = url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
test('Realtime context and durable admission against local Auth/PostgREST (no audio mock claims)', { skip: !local && 'Local Supabase is unavailable' }, async t => {
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await db.from('vexbot_voice_sessions').select('id', { head: true }).limit(1);
  if (probe.error) { t.skip('Apply the Realtime session migration to the local test database first.'); return; }
  const ok = result => { assert.equal(result.error, null); return result.data; };
  const tag = randomUUID().slice(0, 8), password = 'Synthetic-Passw0rd';
  const users = [];
  for (const name of ['voice-a', 'voice-b']) {
    const email = `${name}-${tag}@example.test`;
    const { user } = ok(await db.auth.admin.createUser({ email, password, email_confirm: true }));
    ok(await db.rpc('portal_provision_client', { user_id: user.id, contact: name, company: `Voice QA ${tag}`, email }));
    const client = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { session } = ok(await client.auth.signInWithPassword({ email, password }));
    users.push({ id: user.id, req: { headers: { authorization: `Bearer ${session.access_token}` } } });
  }
  const [a, b] = users;
  const published = async (workspace, title, content) => {
    const doc = ok(await db.from('vexbot_documents').insert({ workspace_id: workspace, title, content, created_by: a.id }).select('id').single());
    ok(await db.rpc('vexbot_set_status', { document: doc.id, next: 'in_review', actor: a.id }));
    ok(await db.rpc('vexbot_set_status', { document: doc.id, next: 'published', actor: a.id, passages: [content] }));
    return doc.id;
  };
  const doc = await published(a.id, `Voice QA A ${tag}`, 'The zephyr project milestone is proposed, not completed.');
  const foreign = await published(b.id, `Voice QA B ${tag}`, 'The zephyr private Beta secret is undisclosed.');
  t.after(async () => {
    for (const id of [doc, foreign]) await db.rpc('vexbot_set_status', { document: id, next: 'retired', actor: a.id });
  });
  await assert.rejects(voiceContext(b.req, { workspace_id: a.id }, db), /access/);
  const context = await voiceContext(a.req, { workspace_id: a.id }, db);
  await assert.rejects(voiceContext(b.req, { workspace_id: b.id, conversation_id: context.conversation.id }, db), /Conversation not found/);
  const planned = await context.lookup('zephyr project milestone');
  assert.ok(planned.sources.some(s => s.document_id === doc));
  assert.ok(!planned.sources.some(s => s.document_id === foreign));
  await context.userMessage('Correction: it is only proposed.');
  const sources = planned.sources.filter(s => s.document_id === doc);
  await context.evidence(sources);
  await context.assistantMessage('The milestone is proposed, not completed.', sources);
  const saved = await context.snapshot();
  assert.equal(saved.messages.at(-1).citations[0].document_id, doc);
  const resumed = await voiceContext(a.req, { workspace_id: a.id, conversation_id: context.conversation.id }, db);
  assert.ok((await resumed.history()).some(m => m.content.includes('Correction:')));
  const lease = await admit(db, context, async () => {});
  await assert.rejects(admit(db, context, async () => {}), /already active/);
  ok(await db.from('vexbot_voice_sessions').update({ state: 'ended' }).eq('id', lease));
  await db.rpc('vexbot_set_status', { document: doc, next: 'retired', actor: a.id });
  await assert.rejects(context.evidence(sources), /withdrawn/);
  assert.equal((await context.snapshot()).messages.at(-1).withdrawn, true);
  ok(await db.from('portal_profiles').update({ active: false }).eq('id', a.id));
  await assert.rejects(context.refresh(), /Access denied/);
});
