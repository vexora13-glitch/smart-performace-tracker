import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createVoiceHandler } from '../server/vexbot/realtime-handler.mjs';
import { HttpError } from '../server/validation.mjs';
import { createCall, hangUp, portalRealtimeSession, supervise, realtimeReadiness } from '../server/vexbot/realtime.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  static latest;
  readyState = 1;
  sent = [];
  constructor(url, options) { super(); this.url = url; this.options = options; Socket.latest = this; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  event(value) { this.emit('message', JSON.stringify(value)); }
}
async function fixture(t, overrides = {}) {
  const written = [], emitted = [], ended = [];
  const session = portalRealtimeSession([]);
  const context = {
    async refresh() {}, async evidence() {},
    async lookup() { return { sources: [{ id: 'S1', kind: 'document', document_id: 'doc', title: 'Approved', content: 'Support is weekdays.' }], history: [], notes: [], fallback: 'I cannot confirm that. Please message the team.' }; },
    async userMessage(text) { written.push({ role: 'user', text }); },
    async assistantMessage(text, sources, interrupted) { written.push({ role: 'assistant', text, sources, interrupted }); },
    async snapshot() { return { conversation: { id: 'conv' }, messages: written }; },
    ...overrides,
  };
  const supervisor = supervise({ callId: 'rtc_test', session, context, emit: value => emitted.push(value), terminate: async id => ended.push(id), Socket });
  supervisor.ready.catch(() => {});
  t.after(() => supervisor.finish('test'));
  const socket = Socket.latest;
  socket.emit('open');
  socket.event({ type: 'session.updated', session });
  await supervisor.ready;
  return { supervisor, socket, written, emitted, ended, session };
}
const response = (socket, id, name, args) => {
  if (!socket.sent.some(e => e.type === 'response.create')) socket.event({ type: 'input_audio_buffer.speech_stopped' });
  const metadata = socket.sent.filter(e => e.type === 'response.create').at(-1).response.metadata;
  socket.event({ type: 'response.created', response: { id, metadata } });
  socket.event({ type: 'response.done', response: { id, status: 'completed', usage: { input_tokens: 2, output_tokens: 3 }, output: [{ type: 'function_call', call_id: `call_${id}`, name, arguments: JSON.stringify(args) }] } });
};

test('live voice admission is opt-in and preserves the audited model and voice', () => {
  assert.equal(realtimeReadiness({ OPENAI_API_KEY: 'key' }).available, false);
  assert.equal(realtimeReadiness({ OPENAI_API_KEY: 'key', VEXBOT_REALTIME_ENABLED: 'true' }).available, true);
  const config = portalRealtimeSession([{ role: 'user', content: 'Correction: proposed, not completed.' }]);
  assert.equal(config.model, 'gpt-realtime-2.1-mini');
  assert.equal(config.audio.output.voice, 'cedar');
  assert.equal(realtimeReadiness({ OPENAI_API_KEY: 'key', VEXBOT_REALTIME_ENABLED: 'true' }).voice, 'cedar');
  assert.equal(config.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(config.audio.input.turn_detection.create_response, false, 'the server owns response creation');
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  assert.equal(config.tool_choice.name, 'workspace_knowledge');
  assert.ok(config.instructions.includes('Later corrections'));
  assert.match(config.audio.input.transcription.prompt, /Vexora, Vexbot, Smart Express/);
});

test('recognised turns retrieve directly, skip the query-planning model round and deduplicate transcripts', async t => {
  const questions = [];
  const f = await fixture(t, { async lookup(question) { questions.push(question); return { sources: [{ id: 'S1', title: 'Hours', content: 'Support is weekdays.' }], history: [], fallback: 'Please message the team.' }; } });
  f.socket.event({ type: 'input_audio_buffer.speech_started', item_id: 'u-direct' });
  f.socket.event({ type: 'input_audio_buffer.speech_stopped', item_id: 'u-direct' });
  assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 0, 'no redundant model query while transcription finishes');
  for (let i = 0; i < 2; i++) f.socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u-direct', transcript: 'Support hours?' });
  await tick(); await tick();
  assert.deepEqual(questions, ['Support hours?']);
  assert.equal(f.written.filter(m => m.role === 'user').length, 1);
  assert.equal(f.socket.sent.at(-1).response.tool_choice.name, 'prepare_answer');
  response(f.socket, 'approved', 'prepare_answer', { kind: 'grounded', answered: true, answer: 'Support is weekdays.', sources: ['S1'] });
  await tick(); await tick();
  assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 2);
  assert.match(f.socket.sent.at(-1).response.instructions, /Support is weekdays/);
});

test('a newer recognised turn supersedes an outstanding lookup, carrying the unanswered words without speaking stale evidence', async t => {
  let resolveOld;
  const questions = [];
  const f = await fixture(t, { lookup(question) { questions.push(question); return question === 'Old request' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ reply: 'New reply' }); } });
  for (const [item_id, transcript] of [['old', 'Old request'], ['new', 'New request']]) {
    f.socket.event({ type: 'input_audio_buffer.speech_started', item_id });
    f.socket.event({ type: 'input_audio_buffer.speech_stopped', item_id });
    f.socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript });
    await tick(); await tick();
  }
  assert.deepEqual(questions, ['Old request', 'Old request New request']);
  resolveOld({ reply: 'Stale reply' }); await tick(); await tick();
  assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 1);
  assert.match(f.socket.sent.at(-1).response.instructions, /New reply/);
});

test('SDP exchange uses the server credential, approved config and privacy-preserving identifier', async () => {
  const config = portalRealtimeSession([]);
  const call = await createCall('v=0\r\n', config, 'user', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(JSON.parse(init.body.get('session')).audio.output.voice, 'cedar');
    assert.match(init.headers['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/);
    return new Response('answer', { headers: { Location: '/v1/realtime/calls/rtc_test' } });
  });
  assert.deepEqual(call, { answer: 'answer', callId: 'rtc_test' });
  await assert.rejects(createCall('v=0', config, 'user', async () => new Response('', { status: 404 })), /No alternative voice/);
});

test('server retrieves evidence, validates source ids, then speaks and saves only after playback', async t => {
  const { socket, written, supervisor } = await fixture(t);
  socket.event({ type: 'input_audio_buffer.speech_started' });
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'When is support?' });
  response(socket, 'r1', 'workspace_knowledge', { question: 'When is support?' });
  await tick(); await tick();
  assert.equal(socket.sent.at(-1).response.tool_choice.name, 'prepare_answer');
  response(socket, 'r2', 'prepare_answer', { kind: 'grounded', answered: true, answer: 'Support is weekdays.', sources: ['S1'] });
  await tick(); await tick();
  assert.equal(socket.sent.at(-1).response.tool_choice, 'none');
  assert.equal(written.filter(x => x.role === 'assistant').length, 0);
  socket.event({ type: 'output_audio_buffer.started' });
  socket.event({ type: 'response.done', response: { id: 'r3', status: 'completed', output: [] } });
  assert.equal(written.filter(x => x.role === 'assistant').length, 0, 'generation completion is not playback completion');
  socket.event({ type: 'output_audio_buffer.stopped' });
  await tick(); await tick();
  assert.equal(written.at(-1).sources[0].document_id, 'doc');
  assert.equal(written.at(-1).interrupted, false);
  const result = await supervisor.finish('ended');
  assert.equal(result.terminated, true);
  assert.ok(result.output > 0);
});

test('invented citations fail closed to the no-evidence answer', async t => {
  const { socket } = await fixture(t);
  response(socket, 'r1', 'workspace_knowledge', { question: 'When?' }); await tick(); await tick();
  response(socket, 'r2', 'prepare_answer', { kind: 'grounded', answered: true, answer: 'Tomorrow!', sources: ['FAKE'] }); await tick(); await tick();
  assert.match(socket.sent.at(-1).response.instructions, /cannot confirm/);
  assert.ok(!socket.sent.at(-1).response.instructions.includes('Tomorrow!'));
});

test('incomplete generated audio never persists the full approved text as completely heard', async t => {
  const { supervisor, socket, written } = await fixture(t);
  supervisor.greet();
  const metadata = socket.sent.at(-1).response.metadata;
  socket.event({ type: 'response.created', response: { id: 'short-audio', metadata } });
  socket.event({ type: 'output_audio_buffer.started', response_id: 'short-audio' });
  socket.event({ type: 'response.done', response: { id: 'short-audio', status: 'incomplete', output: [] } });
  socket.event({ type: 'output_audio_buffer.stopped', response_id: 'short-audio' });
  await tick(); await tick();
  assert.equal(written.at(-1).interrupted, true);
});

test('hangup retries transient failure and accepts a provider-confirmed missing call', async () => {
  let attempts = 0;
  await hangUp('rtc_test', async () => { if (++attempts === 1) throw new Error('network'); return new Response('', { status: 404 }); });
  assert.equal(attempts, 2);
});

test('server duration and response ceilings terminate calls without client cooperation', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 90; i++) f.socket.event({ type: 'response.done', response: { id: `r${i}`, status: 'completed', output: [] } });
  assert.equal((await f.supervisor.done).reason, 'allowance');
  const s = supervise({ callId: 'rtc_duration', session: f.session, context: { async assistantMessage() {} }, emit() {}, terminate: async () => {}, Socket, seconds: 0.01 });
  s.ready.catch(() => {});
  assert.equal((await s.done).reason, 'duration');
});

test('a response created after its turn was interrupted is cancelled, never reused for the new turn', async t => {
  const { supervisor, socket } = await fixture(t);
  supervisor.beginTurn();
  const previous = socket.sent.at(-1).response.metadata;
  socket.event({ type: 'input_audio_buffer.speech_started', item_id: 'new-user' });
  socket.event({ type: 'input_audio_buffer.speech_stopped' });
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'new-user', transcript: 'New topic' });
  socket.event({ type: 'response.created', response: { id: 'late', metadata: previous } });
  assert.ok(socket.sent.some(e => e.type === 'response.cancel' && e.response_id === 'late'));
  socket.event({ type: 'response.done', response: { id: 'late', status: 'cancelled' } });
  await tick(); await tick();
  assert.equal(socket.sent.at(-1).type, 'response.create');
  assert.notEqual(socket.sent.at(-1).response.metadata.vexbot_nonce, previous.vexbot_nonce);
  assert.deepEqual(socket.sent.at(-1).response.output_modalities, ['text']);
});

test('concurrent authenticated end and inconclusive supervisor hangup cannot resurrect a lease', async () => {
  const user = { id: '22222222-2222-4222-8222-222222222222', email_confirmed_at: 'yes' };
  const lease = '33333333-3333-4333-8333-333333333333';
  const row = { id: lease, state: 'starting', call_id: 'rtc_test' };
  let resolveDone, signalReady;
  const ready = new Promise(resolve => { signalReady = resolve; });
  const done = new Promise(resolve => { resolveDone = resolve; });
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ data: lease }),
    from(table) {
      let update;
      const q = {
        select() { return q; }, eq() { return q; }, neq() { return q; }, lt() { return q; },
        update(value) { update = value; return q; },
        single: async () => ({ data: { role: 'client', active: true } }),
        maybeSingle: async () => ({ data: table === 'vexbot_voice_sessions' ? row : null }),
        then(resolve) { if (update) Object.assign(row, update); return Promise.resolve({ data: [] }).then(resolve); },
      };
      return q;
    },
  };
  const handler = createVoiceHandler({ getDatabase: () => db, enabled: () => ({ available: true }), getContext: async () => ({ user: user.id, workspace: user.id, conversation: { id: user.id }, history: async () => [] }), connect: async () => ({ answer: 'sdp', callId: 'rtc_test' }), terminate: async () => {}, superviseCall: () => ({ ready: Promise.resolve(), done, greet() {}, finish: () => done }) });
  const res = new EventEmitter();
  Object.assign(res, { setHeader() {}, status() { return res; }, flushHeaders() { res.headersSent = true; }, write(value) { if (JSON.parse(value).type === 'ready') signalReady(); }, end() {}, json() {} });
  const req = { method: 'POST', headers: { authorization: 'Bearer a.eyJpYXQiOjEwMH0.z' }, body: { sdp: 'v=0' } };
  const running = handler(req, res);
  await ready;
  const endRes = { setHeader() {}, status() { return endRes; }, json() {} };
  await handler({ ...req, body: { action: 'end', session_id: lease } }, endRes);
  assert.equal(row.state, 'ended');
  resolveDone({ reason: 'connection', terminated: false, responses: 3, input: 4, output: 5 });
  await running;
  assert.equal(row.state, 'ended');
  assert.equal(row.responses, 3);
});

test('interruption discards late tools and saves an omitted-words marker, not unheard text', async t => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const { socket, supervisor, written } = await fixture(t, { lookup: () => pending });
  response(socket, 'slow', 'workspace_knowledge', { question: 'Old topic' }); await tick();
  socket.event({ type: 'input_audio_buffer.speech_started' });
  const before = socket.sent.length;
  resolve({ sources: [], history: [] }); await tick(); await tick();
  assert.equal(socket.sent.length, before);
  supervisor.greet();
  socket.event({ type: 'output_audio_buffer.started' });
  socket.event({ type: 'input_audio_buffer.speech_started' });
  await tick(); await tick();
  assert.equal(written.at(-1).interrupted, true);
  // Native WebRTC owns audio truncation; the supervisor never estimates audio_end_ms.
  assert.equal(socket.sent.some(e => e.type === 'conversation.item.truncate'), false);
});

test('supervision terminates on tampering, lost access, provider failure or socket loss', async t => {
  for (const mode of ['tamper', 'access', 'provider', 'close']) await t.test(mode, async t => {
    const f = await fixture(t, mode === 'access' ? { refresh: async () => { throw new Error('revoked'); } } : {});
    if (mode === 'tamper') f.socket.event({ type: 'session.updated', session: { ...f.session, audio: { output: { voice: 'alloy' } } } });
    if (mode === 'access') response(f.socket, 'r1', 'workspace_knowledge', { question: 'Private data?' });
    if (mode === 'provider') f.socket.event({ type: 'response.done', response: { status: 'failed' } });
    if (mode === 'close') f.socket.emit('close');
    const result = await f.supervisor.done;
    assert.equal(result.terminated, true);
    assert.deepEqual(f.ended, ['rtc_test']);
  });
});

test('voice endpoint rejects missing auth, inaccessible workspace, invalid SDP and foreign end id', async () => {
  const user = { id: '22222222-2222-4222-8222-222222222222', email_confirmed_at: 'yes' };
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    from() { const q = { select() { return q; }, eq() { return q; }, single: async () => ({ data: { active: true, role: 'client' } }), maybeSingle: async () => ({ data: null }) }; return q; },
  };
  const handler = createVoiceHandler({ getDatabase: () => db, enabled: () => ({ available: true }), getContext: async () => { throw new HttpError(403, 'You do not have access to this workspace.'); } });
  const run = async (headers, body) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
    await handler({ method: 'POST', headers, body }, res);
    return res;
  };
  assert.equal((await run({}, {})).code, 401);
  const headers = { authorization: 'Bearer a.eyJpYXQiOjEwMH0.z' };
  assert.equal((await run(headers, { sdp: 'invalid' })).code, 400);
  assert.equal((await run(headers, { sdp: 'v=0' })).code, 403);
  assert.equal((await run(headers, { action: 'end', session_id: user.id })).code, 404);
});

test('session migration enforces durable concurrency, rate limits and service-role-only access in PostgreSQL', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table portal_profiles(id uuid primary key, active boolean default true);
    create table portal_clients(id uuid primary key);
    create table vexbot_conversations(id uuid primary key, user_id uuid references portal_profiles(id), workspace_id uuid);
    grant usage on schema public to service_role;
    grant select on portal_profiles,vexbot_conversations to service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261109021904_vexbot_realtime_sessions.sql', import.meta.url), 'utf8'));
  const person = '22222222-2222-4222-8222-222222222222', conversation = '33333333-3333-4333-8333-333333333333';
  await db.query('insert into portal_profiles(id) values($1)', [person]);
  await db.query('insert into vexbot_conversations values($1,$2,null)', [conversation, person]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from vexbot_voice_sessions'), /permission denied/);
    await assert.rejects(db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]);
  await assert.rejects(db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]), /voice_busy/);
  await db.exec("update vexbot_voice_sessions set expires_at=now()-interval '1 minute'");
  await assert.rejects(db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]), /voice_busy/, 'expired live call must be terminated before reclaiming');
  for (let i = 1; i < 6; i++) {
    await db.exec("update vexbot_voice_sessions set state='ended'");
    await db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]);
  }
  await db.exec("update vexbot_voice_sessions set state='ended'");
  await assert.rejects(db.query('select vexbot_voice_admit($1,null,$2)', [person, conversation]), /voice_limit/);
});
