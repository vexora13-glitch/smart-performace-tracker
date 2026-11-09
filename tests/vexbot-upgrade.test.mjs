import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistory, tokenUpperBound, retrievalQueries } from '../server/vexbot/context.mjs';
import { referenceRealtimeSession, realtimeReadiness } from '../server/vexbot/realtime.mjs';
import { validateAnswer, systemPrompt } from '../server/vexbot/prompt.mjs';

test('context preserves recent corrections in order within a conservative token budget', () => {
  const turns = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `Turn ${i}`,
  }));
  turns.push({ role: 'user', content: 'Correction: delivery is proposed, not approved.' });
  const selected = selectHistory(turns, 180);
  assert.equal(selected.at(-1).content, turns.at(-1).content);
  assert.ok(selected.reduce((n, t) => n + tokenUpperBound(t.content) + 12, 0) <= 180);
  assert.deepEqual(selected, turns.slice(-selected.length));
  assert.deepEqual(selectHistory([{ role: 'user', content: 'too large'.repeat(100) }], 20), []);
});
test('withdrawn answers never re-enter model context; unicode is budgeted as UTF-8', () => {
  assert.deepEqual(
    selectHistory([{ role: 'assistant', content: 'Retired claim', withdrawn: true }]),
    [],
  );
  assert.equal(tokenUpperBound('a'), 1);
  assert.equal(tokenUpperBound('\u{1f600}'), 4);
});
test('retrieval prioritises new topic then bounded prior client statements', () => {
  const history = [
    { role: 'user', content: 'Mobile app' },
    { role: 'assistant', content: 'How delivered?' },
    { role: 'user', content: 'Online' },
  ];
  assert.deepEqual(retrievalQueries('What about support?', history), [
    'What about support?',
    'Online',
    'Mobile app',
  ]);
});
test('conversational replies can acknowledge without inventing a citation; grounded replies require valid ids', () => {
  assert.equal(
    validateAnswer(
      { kind: 'conversation', answered: true, answer: 'Thanks, I understand.', sources: [] },
      [],
    ).answered,
    true,
  );
  assert.equal(
    validateAnswer({ kind: 'grounded', answered: true, answer: 'Done.', sources: [] }, []).answered,
    false,
  );
  assert.equal(
    validateAnswer({ answered: true, answer: 'Done.', sources: ['S1', 'FAKE'] }, [{ id: 'S1' }])
      .answered,
    false,
  );
});
test('reference voice contract retains Marin and requested model without fallback or admitting live calls', () => {
  const s = referenceRealtimeSession('Only authorised context.');
  assert.equal(s.model, 'gpt-realtime-2.1-mini');
  assert.equal(s.audio.output.voice, 'marin');
  assert.deepEqual(s.audio.input.turn_detection, {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    create_response: true,
    interrupt_response: true,
  });
  assert.equal(s.truncation.retention_ratio, 0.8);
  assert.equal(s.truncation.token_limits.post_instructions, 4000);
  assert.equal(s.max_output_tokens, 800);
  assert.equal(realtimeReadiness().available, false);
});
test('portal instructions encode correction, source conflicts, lifecycle status and no fictitious contact actions', () => {
  const prompt = systemPrompt({});
  for (const rule of [
    'Later corrections',
    'at most one',
    'conflicting sources',
    'proposed',
    'No submission or booking tool',
    'New Zealand English',
    'untrusted data',
  ])
    assert.ok(prompt.includes(rule), rule);
});
