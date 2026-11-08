// Pure logic behind Vexbot's workspace files and hands-free voice: which file a question means, and when a
// speaker has started and finished. The database-backed behaviour is in tests/vexbot-files-local.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentions, problemText, refersToFile, requestedName, resolve } from '../server/vexbot/sources.mjs';
import { UtteranceDetector } from '../src/vexbot/voice.ts';
import { extractText } from '../server/vexbot/files.mjs';
import { pdf, PIKE_POINT } from './helpers/pdf.mjs';

test('a question names a file by its full name or a distinctive base name, however it is quoted', () => {
  for (const question of ['Summarize `pike point.pdf`', 'summarise “Pike Point.pdf” please', 'What is in pike point?', 'tell me about pike-point.PDF'])
    assert.equal(mentions(question, 'pike point.pdf'), true, question);
  assert.equal(mentions('What is the plan?', 'plan.pdf'), false, 'a short ordinary word is not a file name');
  assert.equal(mentions('Summarize plan.pdf', 'plan.pdf'), true);
  assert.equal(mentions('Summarize the part one notes', 'part-one.txt'), true);
  assert.equal(mentions('Summarize the onboarding guide', 'Synthetic: Onboarding guide'), true, 'a title without its label');
});

test('the requested file name is recovered for an honest "not found"', () => {
  assert.equal(requestedName('Summarize `pike point.pdf`'), 'pike point.pdf');
  assert.equal(requestedName('Summarize pike point.pdf'), 'pike point.pdf');
  assert.equal(requestedName('What does the Q3 report.pdf say?'), 'Q3 report.pdf');
  assert.equal(requestedName('What are your hours?'), null);
  assert.equal(refersToFile('Summarize the document here'), true);
  assert.equal(refersToFile('Can you read my brief?'), true);
  assert.equal(refersToFile('When is the workshop?'), false);
});

test('resolving a question against a workspace inventory', () => {
  const pdfFile = { kind: 'file', id: 'f1', name: 'pike point.pdf', mime: 'application/pdf' };
  const video = { kind: 'file', id: 'f2', name: 'scene01.mp4', mime: 'video/mp4' };
  const held = { kind: 'upload', id: 'u1', name: 'notes.txt', status: 'quarantined' };
  const inv = { files: [pdfFile, video], documents: [], uploads: [held] };
  assert.deepEqual(resolve('Summarize pike point.pdf', inv).targets, [pdfFile]);
  assert.deepEqual(resolve('Summarize other.pdf', inv), { missing: 'other.pdf' });
  assert.deepEqual(resolve('Summarize the document here', inv).targets, [pdfFile], 'the only readable file');
  assert.deepEqual(resolve('Summarize it', inv, { recent: [{ kind: 'file', id: 'f1' }] }).targets, [pdfFile], 'the file just discussed');
  assert.equal(resolve('When is the workshop?', inv).general, true);
  const two = { ...inv, files: [pdfFile, { ...pdfFile, id: 'f3', name: 'budget.pdf' }] };
  assert.equal(resolve('Summarize the document here', two).ambiguous.length, 2);
  assert.match(problemText(video, { status: 'unsupported' }), /is a video I can't read/);
  assert.match(problemText(held, { status: 'upload' }), /“notes\.txt” is quarantined while it is checked for malware/);
  assert.match(problemText(pdfFile, { status: 'processing' }), /still being processed/);
});

test('the synthetic pike point.pdf fixture is a real PDF with extractable text', async () => {
  const { text } = await extractText(pdf(PIKE_POINT), 'application/pdf');
  assert.match(text, /2\.4 km coastal walkway/);
  assert.match(text, /wetland consent/);
});

test('voice mode hears the start and end of an utterance, and gives up on silence', () => {
  const run = (levels, detector = new UtteranceDetector()) => levels.map((level) => detector.step(level, 50));
  const quiet = Array(10).fill(0.002), speech = Array(30).fill(0.08), pause = Array(30).fill(0.002);
  const steps = run([...quiet, ...speech, ...pause]);
  assert.equal(steps.indexOf('started'), 10 + 3, 'speech counts after about 160 ms');
  assert.ok(steps.includes('ended'), 'a pause of about a second ends the turn');
  assert.equal(steps.indexOf('ended') - 40, 21);
  const brief = run([...quiet, 0.08, 0.08, ...Array(400).fill(0.002)]);
  assert.ok(!brief.includes('started'), 'a click is not speech');
  assert.equal(brief.at(-1), 'idle', 'fifteen seconds without speech');
  // A noisy room raises the threshold, so steady background noise is not mistaken for speech.
  const noisy = run([...Array(10).fill(0.02), ...Array(40).fill(0.03)]);
  assert.ok(!noisy.includes('started'));
  const limit = run([...quiet, ...Array(1200).fill(0.1)]);
  assert.equal(limit.at(-1), 'limit', 'one turn is at most 55 seconds');
});
