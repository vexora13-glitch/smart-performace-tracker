// Vexbot reading workspace files, against a LOCAL Supabase stack (real Auth, PostgREST, RLS and Storage).
// Synthetic users and files only; refuses to run unless the configured URL is loopback. Covers the
// "Summarize pike point.pdf" acceptance check and the boundary: shared files and approved uploads of the
// asker's own workspace only, never drafts, quarantined uploads or another client's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { createHandler } from '../server/vexbot/handler.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';
import { createScanner } from '../server/vexbot/scanner.mjs';
import { pdf, PIKE_POINT } from './helpers/pdf.mjs';

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL;
const local = url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);

test('Vexbot reads workspace files (local Supabase)', { skip: !local && 'Local Supabase is not configured (run supabase start)' }, async (t) => {
  const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const mock = () => createProvider({ VEXBOT_PROVIDER: 'mock' });
  const handlerWith = (getProvider) => createHandler({ getProvider, getScanner: () => null, getSetup: () => ({ mode: 'mock', missing: [] }) });
  const run = async (handler, token, body) => {
    let status = 200, json;
    const res = { setHeader() {}, status(code) { status = code; return res; }, json(value) { json = value; return res; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
    return { status, ...json };
  };
  const vexbot = handlerWith(mock);
  const call = (token, body) => run(vexbot, token, body);
  const ok = (result, what) => { assert.equal(result.error, null, `${what}: ${result.error?.message}`); return result.data; };

  const tag = randomUUID().slice(0, 8);
  const password = 'Synthetic-Passw0rd';
  const createUser = async (name) => ok(await service.auth.admin.createUser({ email: `${name}-${tag}@example.test`, password, email_confirm: true }), name).user;
  const signIn = async (email) => {
    const { data, error } = await anon().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session.access_token;
  };
  const staff = await createUser('staff');
  ok(await service.from('portal_profiles').insert({ id: staff.id, role: 'admin', display_name: 'Synthetic Staff' }), 'staff');
  const tess = await createUser('tess'), otto = await createUser('otto');
  ok(await service.rpc('portal_provision_client', { user_id: tess.id, contact: 'Tess Test', company: 'Test', email: tess.email }), 'test workspace');
  ok(await service.rpc('portal_provision_client', { user_id: otto.id, contact: 'Otto Other', company: `Other ${tag}`, email: otto.email }), 'other workspace');
  const [tessToken, ottoToken, staffToken] = [await signIn(tess.email), await signIn(otto.email), await signIn(staff.email)];

  // Shared files, exactly as an administrator shares them: bytes in portal-private, a row in portal_files.
  const share = async (workspace, name, mime, bytes) => {
    const path = `${workspace}/${randomUUID()}/${name}`;
    ok(await service.storage.from('portal-private').upload(path, bytes, { contentType: mime }), `upload ${name}`);
    return ok(await service.from('portal_files').insert({ workspace_id: workspace, name, path, mime_type: mime, size_bytes: bytes.length }).select('*').single(), name);
  };
  const pike = await share(tess.id, 'pike point.pdf', 'application/pdf', pdf(PIKE_POINT));
  await share(tess.id, 'scene01.mp4', 'video/mp4', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]));
  await share(tess.id, 'broken.pdf', 'application/pdf', Buffer.from('<html>this is not a pdf</html>'));
  await share(tess.id, 'scanned letter.pdf', 'application/pdf', pdf([[' ']]));
  const secret = `Otto's confidential margin is 41 percent ${tag}`;
  await share(otto.id, 'otto-secret.txt', 'text/plain', Buffer.from(secret));

  // Client uploads: one quarantined (no scanner), one scanned clean and published by staff.
  const upload = async (token, name, bytes, scanner) => {
    const handler = createHandler({ getProvider: mock, getScanner: () => scanner });
    const created = await run(handler, token, { action: 'upload_create', purpose: 'workspace', workspace_id: tess.id, name, mime: 'text/plain', size: bytes.length });
    ok(await anon().storage.from('vexbot-private').uploadToSignedUrl(created.path, created.token, bytes, { contentType: 'text/plain' }), name);
    return (await run(handler, token, { action: 'upload_complete', upload_id: created.upload_id })).upload;
  };
  const held = await upload(tessToken, 'notes.txt', Buffer.from('Quarantined notes'), null);
  assert.equal(held.status, 'quarantined');
  const brief = await upload(tessToken, 'approved-brief.txt', Buffer.from('raw'), createScanner({ VEXBOT_SCANNER: 'mock' }));
  assert.equal(brief.status, 'clean');
  const publish = async (title, workspace, content, uploadId = null, status = 'published') => {
    const doc = ok(await service.from('vexbot_documents').insert({ title, workspace_id: workspace, upload_id: uploadId, content, created_by: staff.id }).select('id').single(), title);
    if (status !== 'draft') ok(await service.rpc('vexbot_set_status', { document: doc.id, next: 'in_review', actor: staff.id }), 'review');
    if (status === 'published') ok(await service.rpc('vexbot_set_status', { document: doc.id, next: 'published', actor: staff.id, passages: [content] }), 'publish');
    return doc.id;
  };
  const briefDoc = await publish(`Brief ${tag}`, tess.id, 'The booking page brief asks for online bookings with deposit payments.', brief.id);
  // Staff working notes: a draft, which Vexbot must never read.
  await publish(`Staff notes ${tag}`, tess.id, `Internal pricing strategy: target margin 40 percent ${tag}.`, null, 'draft');

  const ask = (token, question, extra = {}) => call(token, { action: 'ask', workspace_id: tess.id, question, ...extra });
  const reply = (result) => result.messages[1];

  await t.test('acceptance: "Summarize `pike point.pdf`" answers from the PDF and cites it', async () => {
    const result = await ask(tessToken, 'Summarize `pike point.pdf`');
    assert.equal(result.status, 200);
    const answer = reply(result);
    assert.equal(answer.outcome, 'answered');
    assert.match(answer.content, /2\.4 km coastal walkway/);
    assert.deepEqual(answer.citations.map((c) => [c.kind, c.title, c.id]), [['file', 'pike point.pdf', pike.id]]);
    const cached = ok(await service.from('vexbot_file_text').select('status,content').eq('file_id', pike.id).single(), 'cache');
    assert.equal(cached.status, 'ready');
    assert.match(cached.content, /NZD 480,000/);
    // The citation is kept with the saved answer, and a follow-up about "it" means the same file.
    const saved = await call(tessToken, { action: 'conversation', conversation_id: result.conversation.id });
    assert.equal(saved.messages[1].citations[0].title, 'pike point.pdf');
    const followUp = reply(await ask(tessToken, 'What are the risks in this document?', { conversation_id: result.conversation.id }));
    assert.equal(followUp.outcome, 'answered');
    assert.match(followUp.content, /wetland consent/);
    assert.equal(followUp.citations[0].title, 'pike point.pdf');
  });

  await t.test('ordinary questions also search shared files; without a name, Vexbot asks which file', async () => {
    const general = reply(await ask(tessToken, 'How long will the coastal walkway be?'));
    assert.equal(general.outcome, 'answered');
    assert.ok(general.citations.some((c) => c.kind === 'file' && c.title === 'pike point.pdf'));
    const which = reply(await ask(tessToken, 'Summarize the document here'));
    assert.equal(which.outcome, 'no_answer');
    assert.match(which.content, /Which file do you mean\? Files I can read here: .*“pike point\.pdf”/);
  });

  await t.test('processing, unsupported, unreadable and empty files each say so, distinct from a service failure', async () => {
    assert.match(reply(await ask(tessToken, 'What happens in scene01.mp4?')).content, /“scene01\.mp4” is a video I can't read/);
    assert.match(reply(await ask(tessToken, 'Summarize broken.pdf')).content, /couldn't open “broken\.pdf”.*damaged/);
    assert.match(reply(await ask(tessToken, 'Summarize scanned letter.pdf')).content, /couldn't find any readable text in “scanned letter\.pdf”/);
    const big = await share(tess.id, 'big report.pdf', 'application/pdf', pdf([['Big report']]));
    ok(await service.from('vexbot_file_text').insert({ file_id: big.id, workspace_id: tess.id, size_bytes: big.size_bytes, status: 'processing' }), 'processing');
    const processing = reply(await ask(tessToken, 'Summarize big report.pdf'));
    assert.equal(processing.outcome, 'no_answer');
    assert.match(processing.content, /“big report\.pdf” is still being processed/);
    // No answer service: a file problem is still reported as such; a readable file reports the service.
    const offline = handlerWith(() => null);
    assert.match(reply(await run(offline, tessToken, { action: 'ask', workspace_id: tess.id, question: 'Summarize scene01.mp4' })).content, /is a video/);
    const notOn = reply(await run(offline, tessToken, { action: 'ask', workspace_id: tess.id, question: 'Summarize pike point.pdf' }));
    assert.equal(notOn.outcome, 'unavailable');
    assert.match(notOn.content, /answer service isn't switched on for this portal yet/);
    const failing = handlerWith(() => ({ name: 'failing', voice: false, answer: async () => { throw Object.assign(new Error('Provider request failed (401)'), { status: 401 }); } }));
    const failed = reply(await run(failing, tessToken, { action: 'ask', workspace_id: tess.id, question: 'Summarize pike point.pdf' }));
    assert.equal(failed.outcome, 'unavailable');
    assert.match(failed.content, /couldn't reach its answer service just now/);
  });

  await t.test('uploads are used only after scanning and review', async () => {
    const quarantined = reply(await ask(tessToken, 'Summarize notes.txt'));
    assert.match(quarantined.content, /“notes\.txt” is quarantined while it is checked for malware\. I can only use uploads after/);
    const approved = reply(await ask(tessToken, 'Summarize approved-brief.txt'));
    assert.equal(approved.outcome, 'answered');
    assert.match(approved.content, /deposit payments/);
    assert.deepEqual(approved.citations.map((c) => [c.kind, c.id]), [['document', briefDoc]]);
  });

  await t.test("staff drafts and other clients' files stay out of reach", async () => {
    const draft = reply(await ask(tessToken, 'What is the target margin in the pricing strategy?'));
    assert.notEqual(draft.outcome, 'answered');
    assert.doesNotMatch(draft.content, /40 percent/);
    const elsewhere = reply(await ask(tessToken, 'Summarize otto-secret.txt'));
    assert.match(elsewhere.content, /couldn't find a file called “otto-secret\.txt” in this workspace/);
    assert.doesNotMatch(elsewhere.content, /41 percent/);
    assert.doesNotMatch(reply(await ask(tessToken, 'What is the confidential margin?')).content, /41 percent/);
    const fromOther = await call(ottoToken, { action: 'ask', workspace_id: otto.id, question: 'Summarize pike point.pdf' });
    assert.match(reply(fromOther).content, /couldn't find a file called “pike point\.pdf”/);
    assert.equal((await call(ottoToken, { action: 'ask', workspace_id: tess.id, question: 'Summarize pike point.pdf' })).status, 403);
    // Browsers cannot read the extracted text directly, even inside their own workspace.
    const browser = anon();
    await browser.auth.signInWithPassword({ email: tess.email, password });
    const direct = await browser.from('vexbot_file_text').select('*');
    assert.ok(direct.error || direct.data.length === 0);
  });

  await t.test('voice mode gets the spoken reply in the same request; staff see what setup is missing', async () => {
    const spoken = await ask(tessToken, 'Summarize pike point.pdf', { speak: true });
    assert.equal(reply(spoken).outcome, 'answered');
    assert.ok(spoken.speech.audio.length > 100);
    assert.equal((await call(tessToken, { action: 'status' })).setup, undefined, 'clients do not see setup');
    assert.deepEqual((await call(staffToken, { action: 'status' })).setup, { mode: 'mock', missing: [], file_index: true });
  });

  await t.test('removing a shared file withdraws answers that cited it', async () => {
    const result = await ask(tessToken, 'Summarize pike point.pdf');
    ok(await service.storage.from('portal-private').remove([pike.path]), 'remove bytes');
    ok(await service.from('portal_files').delete().eq('id', pike.id), 'remove file');
    const saved = await call(tessToken, { action: 'conversation', conversation_id: result.conversation.id });
    assert.equal(saved.messages[1].withdrawn, true);
    assert.match(saved.messages[1].content, /shared file it relied on was removed/);
    assert.equal((await service.from('vexbot_file_text').select('file_id').eq('file_id', pike.id)).data.length, 0, 'cached text goes with the file');
  });

  // Synthetic knowledge from this run is retired; accounts are disabled.
  t.after(async () => {
    const { data } = await service.from('vexbot_documents').select('id').eq('status', 'published').eq('workspace_id', tess.id);
    for (const row of data ?? []) await service.rpc('vexbot_set_status', { document: row.id, next: 'retired', actor: null });
    await service.from('portal_profiles').update({ active: false }).in('id', [tess.id, otto.id, staff.id]);
  });
});
