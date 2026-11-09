// Real HTTP + local Auth/Storage/database; deterministic provider, no hosted data or paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { createHandler } from '../server/vexbot/handler.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';
import { events } from '../src/vexbot/stream.mjs';
import { pdf } from './helpers/pdf.mjs';
import { execFileSync } from 'node:child_process';

const env = { ...loadEnv('localtest', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL;
const local = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
test('streaming HTTP route, workspace intelligence, concurrent customers and cancellation', { skip: !local }, async t => {
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = ({ data, error }) => { assert.equal(error, null); return data; };
  const users = [], files = [];
  let provider = createProvider({ VEXBOT_PROVIDER: 'mock' });
  const handler = createHandler({ getDatabase: () => db, getProvider: () => provider, getScanner: () => null });
  let routeHandler = handler;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const bytes of req) body += bytes;
    req.body = JSON.parse(body);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    await routeHandler(req, res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (files.length) { ok(await db.from('portal_files').delete().in('id', files.map(f => f.id))); ok(await db.storage.from('portal-private').remove(files.map(f => f.path))); }
    for (const user of users) { ok(await db.from('vexbot_conversations').delete().eq('user_id', user.id)); ok(await db.from('portal_clients').delete().eq('id', user.id)); ok(await db.from('portal_profiles').delete().eq('id', user.id)); ok(await db.auth.admin.deleteUser(user.id)); }
  });
  for (let index = 0; index < 2; index++) {
    const email = `stream-${randomUUID()}@example.test`, password = 'Synthetic-Stream-Passw0rd';
    const { user } = ok(await db.auth.admin.createUser({ email, password, email_confirm: true })); users.push(user);
    ok(await db.rpc('portal_provision_client', { user_id: user.id, contact: 'Stream Test', company: 'Synthetic', email }));
    user.token = ok(await anon().auth.signInWithPassword({ email, password })).session.access_token;
    for (const [name, lines] of [['Vexora_Smart_Express_Private_Sale_Proposal_Draft.pdf', ['The proposal delivers a booking website.', `The cost is NZD ${index ? '99,000' : '42,000'}.`]], ['Private-Sale-Statement-of-Work.pdf', ['The statement of work includes weekly training.']]]) {
      const path = `${user.id}/${randomUUID()}/${name}`, bytes = pdf([lines]);
      ok(await db.storage.from('portal-private').upload(path, bytes, { contentType: 'application/pdf' }));
      files.push(ok(await db.from('portal_files').insert({ workspace_id: user.id, path, name, mime_type: 'application/pdf', size_bytes: bytes.length }).select('*').single()));
    }
  }
  const endpoint = `http://127.0.0.1:${server.address().port}/api/vexbot`;
  const request = (user, extra, signal) => fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ action: 'ask', workspace_id: user.id, question: 'Can you summarise the proposal?', ...extra }) });
  const stream = async (user, extra = {}) => {
    const response = await request(user, { stream: true, ...extra });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const frames = [];
    for await (const frame of events(response.body)) frames.push({ event: frame.event, ...JSON.parse(frame.data) });
    assert.equal(frames[0].event, 'status');
    return frames;
  };
  if (process.env.VEXBOT_REPAIR_PDF) await t.test('actual proposal copy: stale failed cache recovers and the exact customer question is cited', async () => {
    const bytes = await readFile(process.env.VEXBOT_REPAIR_PDF);
    const name = 'Customer_Proposal.pdf', path = `${users[0].id}/${randomUUID()}/${name}`;
    ok(await db.storage.from('portal-private').upload(path, bytes, { contentType: 'application/pdf' }));
    const file = ok(await db.from('portal_files').insert({ workspace_id: users[0].id, path, name, mime_type: 'application/pdf', size_bytes: bytes.length }).select('*').single()); files.push(file);
    // Remove the synthetic proposal from the catalogue for this one request, without touching Storage.
    const synthetic = files.find(row => row.workspace_id === users[0].id && row.name.startsWith('Vexora_'));
    ok(await db.from('portal_files').update({ name: 'Synthetic_Booking_Notes.pdf' }).eq('id', synthetic.id));
    try {
      ok(await db.from('vexbot_file_text').insert({ file_id: file.id, workspace_id: users[0].id, size_bytes: bytes.length, status: 'failed', note: 'index-v2:old Text extraction failed.' }));
      const { extractText } = await import('../server/vexbot/files.mjs');
      const extracted = await extractText(bytes, 'application/pdf');
      assert.ok(extracted.text.length > 1000);
      let receivedSource;
      const actual = process.env.VEXBOT_REPAIR_LIVE === '1' ? createProvider(loadEnv('development', process.cwd(), '')) : createProvider({ VEXBOT_PROVIDER: 'mock' });
      assert.ok(actual, 'answer provider is configured');
      provider = { ...actual, async answer(input) { receivedSource = input.sources.find(source => source.file_id === file.id); return actual.answer(input); } };
      const result = (await stream(users[0], { question: 'Can you open the proposal here and summarize it for me?' })).at(-1);
      assert.equal(result.event, 'result');
      assert.equal(result.messages[1].outcome, 'answered');
      assert.equal(receivedSource.content, extracted.text, 'all extracted pages reach the answer provider');
      assert.ok(result.messages[1].citations.some(citation => citation.id === file.id));
      const cached = ok(await db.from('vexbot_file_text').select('status,note,content').eq('file_id', file.id).single());
      assert.equal(cached.status, 'ready'); assert.match(cached.note, /^index-v3:/);
      await writeFile('artifacts/pdf-diagnosis/local-route-result.json', JSON.stringify({ provider: actual.name, sourceCharacters: receivedSource.content.length, pages: (receivedSource.content.match(/\[Page /g) || []).length, answer: result.messages[1] }, null, 2));
    } finally {
      provider = createProvider({ VEXBOT_PROVIDER: 'mock' });
      ok(await db.from('portal_files').update({ name: synthetic.name }).eq('id', synthetic.id));
      ok(await db.from('portal_files').update({ name: 'Customer_Reference.pdf' }).eq('id', file.id));
    }
  });
  await t.test('natural summary, citations, follow-up and cross-workspace isolation over HTTP', async () => {
    const results = await Promise.all(users.map(user => stream(user)));
    for (let index = 0; index < results.length; index++) {
      const result = results[index].at(-1), answer = result.messages[1];
      assert.equal(result.event, 'result'); assert.equal(answer.outcome, 'answered');
      assert.ok(answer.citations.some(c => c.title.includes('Proposal')));
      const follow = (await stream(users[index], { conversation_id: result.conversation.id, question: 'How much will it cost?' })).at(-1);
      assert.match(follow.messages[1].content, new RegExp(index ? '99,000' : '42,000'));
      assert.doesNotMatch(follow.messages[1].content, new RegExp(index ? '42,000' : '99,000'));
    }
    const denied = await stream(users[1], { workspace_id: users[0].id });
    assert.equal(denied.at(-1).event, 'error'); assert.ok(denied.every(event => event.event !== 'delta'));
  });
  await t.test('a genuine provider delta arrives before completion and cancellation aborts generation', async () => {
    let aborted;
    const stopped = new Promise(resolve => { aborted = resolve; });
    provider = { name: 'controlled-test', async answer({ onDelta, signal }) {
      await onDelta('The proposal delivers a booking website.');
      return new Promise((_, reject) => { signal.addEventListener('abort', () => { aborted(); reject(signal.reason); }, { once: true }); });
    } };
    const controller = new AbortController();
    const response = await request(users[0], { stream: true, question: 'Summarise the proposal' }, controller.signal);
    let delta = false;
    for await (const frame of events(response.body)) {
      if (frame.event === 'delta') { delta = true; controller.abort(); break; }
    }
    assert.equal(delta, true);
    await stopped;
    provider = createProvider({ VEXBOT_PROVIDER: 'mock' });
  });
  await t.test('warm local mock timings are recorded separately from live provider performance', async () => {
    const samples = [];
    for (let index = 0; index < 10; index++) {
      const started = performance.now();
      const result = (await stream(users[0], { question: 'What is the proposal cost?' })).at(-1);
      samples.push({ http_total: performance.now() - started, ...result.timings });
    }
    const stats = Object.fromEntries(Object.keys(samples[0]).map(key => { const sorted = samples.map(s => s[key]).sort((a, b) => a - b); return [key, { p50: sorted[4], p95: sorted[9] }]; }));
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/vexbot-warm-local.json', JSON.stringify({ condition: '10 warm local HTTP requests; real local Auth/Storage/PostgREST; deterministic mock AI; no live model TTFT', stats, samples }, null, 2));
    assert.ok(samples.every(sample => sample.catalogue >= 0 && sample.retrieval >= 0));
  });
  if (process.env.VEXBOT_BASELINE_REF) await t.test('compare the original committed route with the current implementation', async () => {
    const ref = process.env.VEXBOT_BASELINE_REF;
    const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const original = path => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', windowsHide: true });
    const rewrite = (source, base) => source.replace(/from '(\.[^']+)'/g, (_, relative) => `from '${new URL(relative, base).href}'`);
    const sourceModule = asModule(rewrite(original('server/vexbot/sources.mjs'), new URL('../server/vexbot/sources.mjs', import.meta.url)));
    const handlerModule = asModule(rewrite(original('server/vexbot/handler.mjs').replace("from './sources.mjs'", `from '${sourceModule}'`), new URL('../server/vexbot/handler.mjs', import.meta.url)));
    const baseline = (await import(handlerModule)).createHandler({ getDatabase: () => db, getProvider: () => provider, getScanner: () => null });
    const samples = { before: [], after: [] };
    for (let index = 0; index < 10; index++) for (const [name, implementation] of [['before', baseline], ['after', handler]]) {
      routeHandler = implementation;
      const started = performance.now();
      const response = await request(users[0], { stream: false, question: 'Summarise Vexora_Smart_Express_Private_Sale_Proposal_Draft.pdf' });
      const result = await response.json();
      assert.equal(result.messages[1].outcome, 'answered');
      samples[name].push(performance.now() - started);
    }
    routeHandler = handler;
    const stats = Object.fromEntries(Object.entries(samples).map(([key, values]) => { const sorted = [...values].sort((a, b) => a - b); return [key, { p50: sorted[4], p95: sorted[9] }]; }));
    await writeFile('artifacts/vexbot-before-after.json', JSON.stringify({ ref, condition: '10 alternating warm requests per implementation; same local database, cached PDF and deterministic AI; exact filename; measures full HTTP completion, not live provider latency', stats, samples }, null, 2));
  });
});
