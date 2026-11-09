import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, fileSources, sharedText } from '../server/vexbot/sources.mjs';
import { chunk, pageChunks } from '../server/vexbot/files.mjs';
import { events, partialAnswer } from '../src/vexbot/stream.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';

const file = (id, name, mime = 'application/pdf') => ({ kind: 'file', id, name, mime, workspace_id: 'workspace-a' });
const proposal = file('p', 'Vexora_Smart_Express_Private_Sale_Proposal_Draft.pdf');
const sow = file('s', 'Private-Sale-Statement-of-Work.pdf');
const proposalVideo = file('pv', 'PROPOSAL Video.MP4', 'video/mp4');
const sowVideo = file('sv', 'SOW Video.MP4', 'video/mp4');
const inv = { files: [proposal, sow, proposalVideo, sowVideo], documents: [], uploads: [] };
const recent = [{ kind: 'file', id: proposal.id }];
test('natural titles, partial names, misspellings and document types resolve without filenames', () => {
  for (const question of ['Can you summarise the proposal in a few minutes?', 'quick proposal summary', 'summarise the proposla', 'summarise Smart Express', 'summarise proposal.pdf'])
    assert.deepEqual(resolve(question, inv).targets, [proposal], question);
  for (const question of ['Summarise the SOW', 'read the statement of work']) assert.deepEqual(resolve(question, inv).targets, [sow], question);
  assert.deepEqual(resolve('summarise the proposal video', inv).targets, [proposalVideo]);
  assert.deepEqual(resolve('summarise SOW video', inv).targets, [sowVideo]);
  const identical = { files: [file('pdf', 'proposal.pdf'), file('mp4', 'proposal.mp4', 'video/mp4')], documents: [], uploads: [] };
  assert.deepEqual(resolve('summarise the proposal', identical).targets.map(row => row.id), ['pdf']);
  assert.deepEqual(resolve('summarise proposal.mp4', identical).targets.map(row => row.id), ['mp4']);
  assert.deepEqual(resolve('Summarise the quotation', { files: [file('q', 'Website_Quotation_Final.pdf')], documents: [], uploads: [] }).targets.map(f => f.id), ['q']);
});
test('ambiguous metadata asks once; follow-ups and comparisons preserve authorised evidence', () => {
  const two = { ...inv, files: [...inv.files, file('p2', 'Second_Proposal.pdf')] };
  assert.equal(resolve('summarise the proposal', two).ambiguous.length, 2);
  for (const question of ['What are the deliverables?', 'How much will it cost?', 'What is the timeline?']) assert.deepEqual(resolve(question, inv, { recent }).targets, [proposal]);
  assert.deepEqual(resolve('Compare that with the SOW', inv, { recent }).targets, [proposal, sow]);
  assert.deepEqual(resolve('Compare that with Private-Sale-Statement-of-Work.pdf', inv, { recent }).targets, [proposal, sow]);
  assert.equal(resolve('How much will it cost?', { ...inv, files: [] }, { recent }).targets, undefined);
});
test('whole-document summaries include the final section; factual queries select relevant passages', () => {
  const content = 'Opening context.\n\n' + 'Background details.\n\n'.repeat(7000) + 'Final pricing: NZD 42,000.';
  const summary = fileSources([{ item: proposal, content }], 'Summarise the proposal')[0];
  assert.equal(summary.content, content);
  const factual = fileSources([{ item: proposal, content }], 'What is the pricing?')[0];
  assert.match(factual.content, /NZD 42,000/);
  assert.ok(factual.content.length <= 12000);
  assert.equal(factual.whole, false);
  const uninterrupted = 'a'.repeat(5000);
  assert.equal(chunk(uninterrupted).join(''), uninterrupted, 'long unbroken paragraphs lose no bytes');
  assert.ok(pageChunks('[Page 9]\n' + 'Long page text. '.repeat(300)).every(passage => passage.startsWith('[Page 9]')));
});
const body = (text, step = 1) => new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let at = 0; at < bytes.length; at += step) controller.enqueue(bytes.slice(at, at + step)); controller.close(); } });
test('SSE handles every-byte UTF-8 and CRLF fragmentation, comments and truncated frames', async () => {
  const text = ': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":"Kia ora \u{1f600}"}\r\n\r\nevent: result\ndata: {}\n\n';
  const output = [];
  for await (const event of events(body(text))) output.push(event);
  assert.deepEqual(output, [{ event: 'delta', data: '{"text":"Kia ora \u{1f600}"}' }, { event: 'result', data: '{}' }]);
  await assert.rejects(async () => { for await (const _ of events(body('data: unfinished'))) {} }, /interrupted/);
});
test('partial JSON never streams before known citation metadata and tolerates escaped characters', () => {
  const sources = [{ id: 'F1' }];
  const result = { answered: true, kind: 'grounded', sources: ['F1'], answer: 'A "quote"\nKia ora \u{1f600}.' };
  const json = JSON.stringify(result);
  let previous = '';
  for (let end = 0; end <= json.length; end++) {
    const text = partialAnswer(json.slice(0, end), sources);
    assert.ok(text.startsWith(previous)); previous = text;
  }
  assert.equal(previous, result.answer);
  assert.equal(partialAnswer(json, []), '');
  assert.equal(partialAnswer(JSON.stringify({ ...result, answered: false }), sources), '');
});
test('actual provider adapter streams upstream chunks, preserves model and aborts broken streams', async t => {
  const fetchBefore = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetchBefore; });
  const result = { answered: true, kind: 'grounded', sources: ['F1'], answer: 'Verified pricing: NZD 42,000.' };
  const raw = JSON.stringify(result);
  let complete = true, request;
  globalThis.fetch = async (_, init) => {
    request = JSON.parse(init.body);
    return new Response(body([...raw].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + (complete ? 'data: [DONE]\n\n' : '')), { headers: { 'content-type': 'text/event-stream' } });
  };
  const provider = createProvider({ OPENAI_API_KEY: 'synthetic', VEXBOT_OPENAI_MODEL: 'existing-model' });
  const options = { settings: {}, question: 'cost?', sources: [{ id: 'F1', title: 'Proposal', content: result.answer }], history: [], onDelta: text => { received += text; } };
  let received = '';
  assert.deepEqual(await provider.answer(options), result);
  assert.equal(received, result.answer);
  assert.equal(request.model, 'existing-model');
  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  complete = false;
  await assert.rejects(provider.answer(options), /interrupted/);
});
test('cached extraction revalidates workspace, version fingerprint and changed path at the same size', async () => {
  let cached = null, downloads = 0;
  const db = { supabaseUrl: 'http://localhost', from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: cached }; }, async upsert(row) { cached = row; return {}; } }; }, storage: { from() { return { async download(path) { downloads++; return { data: new Blob([path.endsWith('one') ? 'first text' : 'other text']) }; } }; } } };
  const item = { ...file('cache', 'notes.txt', 'text/plain'), path: 'workspace-a/one', size: 10, version: 'v1' };
  assert.equal((await sharedText(db, item)).content, 'first text');
  await sharedText(db, item);
  assert.equal(downloads, 1);
  assert.equal((await sharedText(db, { ...item, path: 'workspace-a/two' })).content, 'other text');
  assert.equal(downloads, 2);
  await sharedText(db, { ...item, workspace_id: 'workspace-b' });
  assert.equal(downloads, 3);
});
