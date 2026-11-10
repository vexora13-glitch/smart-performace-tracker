// Conversational intelligence, business-fact accuracy and natural live-voice turn handling.
// Offline: no provider, database or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isElliptical, retrievalQueries } from '../server/vexbot/context.mjs';
import { directBusinessAnswer, socialReply, wantsRepeat } from '../server/vexbot/direct-answer.mjs';
import { systemPrompt, unsupportedFigures, validateAnswer } from '../server/vexbot/prompt.mjs';
import { createProvider, RECORDED_VOICE } from '../server/vexbot/provider.mjs';
import {
  portalRealtimeSession,
  spokenText,
  supervise,
  VOICE_GREETING,
  VOICE_STYLE,
  voiceTools,
} from '../server/vexbot/realtime.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const grounded = (answer, sources = ['S1']) => ({ answered: true, kind: 'grounded', answer, sources });
const proposal = {
  id: 'S1',
  title: 'Smart Express proposal v2',
  content:
    'The build is NZD $18,500 plus GST of 15%. Delivery takes twelve weeks from approval, in 3 phases. Support costs $450 per month. Contact projects@vexora.example. The discovery phase is twenty-five days.',
};

test('figures in an answer must appear in the supplied sources or the dialogue', () => {
  const ok = (answer, context) => validateAnswer(grounded(answer), [proposal], context).answered;
  assert.equal(ok('The build is $18,500 plus 15% GST, delivered over 12 weeks in 3 phases.'), true);
  assert.equal(ok('Support is $450 a month, and discovery takes 25 days.'), true);
  assert.equal(ok('The build is $18.5k.'), true, 'equivalent written forms agree');
  assert.equal(ok('The build is $19,500.'), false, 'an invented price is rejected');
  assert.equal(ok('Delivery takes 10 weeks.'), false, 'an invented duration is rejected');
  assert.equal(ok('The total with GST is $21,275.'), false, 'a calculated total is not a sourced fact');
  assert.equal(ok('It is due on 14 March 2027.'), false, 'an invented date is rejected');
  assert.equal(ok('Email sales@vexora.example for details.'), false, 'an invented contact is rejected');
  assert.equal(ok('Email projects@vexora.example for details.'), true);
  assert.equal(ok('See https://unknown.example/pricing.'), false);
  assert.equal(ok('1. Discovery\n2. Build\n3. Launch'), true, 'list numbering is not a claim');
  assert.equal(ok('Smart Express proposal v2 covers the build.'), true, 'a source title may be named');
  assert.equal(
    ok('That is within your $20,000 budget: the build is $18,500.', {
      question: 'Is it within budget?',
      history: [{ role: 'user', content: 'Our budget is 20k.' }],
    }),
    true,
    'a figure the client stated may be reflected back',
  );
  assert.equal(
    validateAnswer({ answered: true, kind: 'conversation', answer: 'Noted: 40 users at launch.', sources: [] }, [], {
      question: 'We expect about 40 users at launch.',
    }).answered,
    true,
  );
  assert.equal(
    validateAnswer({ answered: true, kind: 'conversation', answer: 'Noted: 400 users at launch.', sources: [] }, [], {
      question: 'We expect about 40 users at launch.',
    }).answered,
    false,
  );
  assert.deepEqual(unsupportedFigures('Costs $5 and 9am starts, 2 options.', 'Nothing relevant.'), ['5']);
});

test('instructions require exact figures, partial answers and reference resolution', () => {
  const prompt = systemPrompt({});
  for (const rule of [
    'professional New Zealand English',
    'Lead with the answer',
    'exactly as the sources write them',
    'Do not calculate, convert, round, total or count',
    'answer only part of a factual question',
    'Resolve references',
    'one sensible reading',
  ])
    assert.ok(prompt.includes(rule), rule);
  const prepare = voiceTools.find((tool) => tool.name === 'prepare_answer').description;
  assert.match(prepare, /digits exactly as the sources state/);
  assert.match(prepare, /only part of the request/);
});

test('elliptical follow-ups are searched with the previous client turn; new topics are not diluted', () => {
  const history = [
    { role: 'user', content: 'Tell me about the Smart Express proposal' },
    { role: 'assistant', content: 'It covers the build and support.' },
  ];
  assert.equal(isElliptical('How much is it?'), true);
  assert.equal(isElliptical('And when?'), true);
  assert.equal(isElliptical('What about that one?'), true);
  assert.equal(isElliptical('What about support?'), false);
  assert.equal(isElliptical('What does the proposal say about the timeline?'), false);
  assert.deepEqual(retrievalQueries('How much is it?', history), [
    'How much is it? Tell me about the Smart Express proposal',
    'How much is it?',
    'Tell me about the Smart Express proposal',
  ]);
  assert.deepEqual(retrievalQueries('What about support?', history), [
    'What about support?',
    'Tell me about the Smart Express proposal',
  ]);
  assert.deepEqual(retrievalQueries('How much is it?', []), ['How much is it?']);
});

test('pleasantries and repeat requests are recognised only as whole utterances', () => {
  assert.match(socialReply('Hello VexBot!'), /How can I help/);
  assert.match(socialReply('Can you hear me?'), /I can hear you/);
  assert.match(socialReply('Great, thank you.'), /welcome/);
  assert.match(socialReply("No, that's all, thanks."), /Goodbye/);
  for (const text of ['Thanks, and what are your hours?', 'Hello, summarise the proposal', 'No', 'Okay', 'Yes please'])
    assert.equal(socialReply(text), '', text);
  for (const text of ['Sorry, can you say that again?', 'Pardon?', 'Could you repeat that please', 'What was that?'])
    assert.equal(wantsRepeat(text), true, text);
  for (const text of ['Say that again in simpler terms', 'Sorry', 'What was that proposal about?', 'Repeat the timeline'])
    assert.equal(wantsRepeat(text), false, text);
});

test('single approved profile fields are read exactly however politely they are asked', () => {
  const profile = {
    hours: '9am–5pm, Monday to Friday, New Zealand time.',
    contact_email: 'hello@vexora.example',
    contact_phone: '09 555 0100',
    location: 'Auckland, New Zealand',
  };
  assert.equal(directBusinessAnswer("What's your email?", profile), profile.contact_email);
  assert.equal(directBusinessAnswer('Hey VexBot, could you tell me your opening hours, please?', profile), profile.hours);
  assert.equal(directBusinessAnswer('When are you open?', profile), profile.hours);
  assert.equal(directBusinessAnswer("What is Vexora's phone number?", profile), profile.contact_phone);
  assert.equal(directBusinessAnswer('Where are you based?', profile), profile.location);
  for (const text of [
    'Are you open right now?',
    'What are your hours on public holidays?',
    'Can you tell me',
    'What is your email and phone number?',
    "What is the client's email?",
  ])
    assert.equal(directBusinessAnswer(text, profile), null, text);
});

test('the live voice is one fixed professional identity with spoken-style delivery', () => {
  const session = portalRealtimeSession([]);
  assert.equal(session.audio.output.voice, 'cedar');
  assert.ok(session.instructions.includes(VOICE_STYLE));
  for (const rule of ['composed, articulate professional', 'measured, unhurried pace', 'lead with the answer', 'Later corrections'])
    assert.ok(VOICE_STYLE.includes(rule), rule);
  assert.match(VOICE_GREETING, /VexBot, Vexora's AI assistant/);
  assert.equal(
    spokenText('**Summary** of [the plan](https://example.test/a) [S1]:\n- First item\n- Second item.\n\n## Costs\nIt is `$4,500` <b>'),
    'Summary of the plan: First item. Second item. Costs. It is $4,500 b',
  );
});

test('recorded replies default to a professional voice; delivery instructions go only to steerable models', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const bodies = [];
  globalThis.fetch = async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array([1]));
  };
  const base = { OPENAI_API_KEY: 'synthetic', VEXBOT_OPENAI_MODEL: 'model', VEXBOT_TRANSCRIBE_MODEL: 'stt' };
  await createProvider({ ...base, VEXBOT_TTS_MODEL: 'tts-1' }).speak('Hello.');
  await createProvider({ ...base, VEXBOT_TTS_MODEL: 'gpt-4o-mini-tts', VEXBOT_TTS_VOICE: 'sage' }).speak('Hello.');
  assert.equal(RECORDED_VOICE, 'ash');
  assert.equal(bodies[0].voice, 'ash');
  assert.equal('instructions' in bodies[0], false);
  assert.equal(bodies[1].voice, 'sage');
  assert.match(bodies[1].instructions, /professional/);
});

// ---- Live turn handling -------------------------------------------------------------------------------------
class Socket extends EventEmitter {
  static latest;
  readyState = 1;
  sent = [];
  constructor() {
    super();
    Socket.latest = this;
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
  }
  event(value) {
    this.emit('message', JSON.stringify(value));
  }
}
async function live(t, lookup) {
  const session = portalRealtimeSession([]);
  const context = {
    async refresh() {},
    async evidence() {},
    lookup,
    async userMessage() {},
    async assistantMessage() {},
    async snapshot() {
      return { conversation: { id: 'conv' }, messages: [] };
    },
  };
  const supervisor = supervise({ callId: 'rtc_test', session, context, emit() {}, terminate: async () => {}, Socket });
  supervisor.ready.catch(() => {});
  t.after(() => supervisor.finish('test'));
  const socket = Socket.latest;
  socket.emit('open');
  socket.event({ type: 'session.updated', session });
  await supervisor.ready;
  const creates = () => socket.sent.filter((event) => event.type === 'response.create');
  /** The provider reports a reply that was requested just before the client spoke again; it is cancelled. */
  const supersede = (id) => {
    const metadata = creates().at(-1).response.metadata;
    socket.event({ type: 'response.created', response: { id, metadata } });
    assert.ok(socket.sent.some((event) => event.type === 'response.cancel' && event.response_id === id));
    socket.event({ type: 'response.done', response: { id, status: 'cancelled' } });
  };
  const say = async (item_id, transcript, stale) => {
    socket.event({ type: 'input_audio_buffer.speech_started', item_id });
    if (stale) supersede(stale);
    socket.event({ type: 'input_audio_buffer.speech_stopped', item_id });
    socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript });
    await tick();
    await tick();
  };
  /** The provider accepts the latest response.create, plays it to the end and reports completion. */
  const play = async (id) => {
    const metadata = creates().at(-1).response.metadata;
    socket.event({ type: 'response.created', response: { id, metadata } });
    socket.event({ type: 'output_audio_buffer.started', response_id: id });
    socket.event({ type: 'response.done', response: { id, status: 'completed', output: [] } });
    socket.event({ type: 'output_audio_buffer.stopped', response_id: id });
    await tick();
    await tick();
  };
  return { socket, creates, say, play, supersede };
}

test('a request spoken over several breaths is answered as one request, and a heard reply starts a fresh one', async (t) => {
  const questions = [];
  const f = await live(t, async (question) => {
    questions.push(question);
    return { reply: `Reply to: ${question}`, history: [] };
  });
  await f.say('a', 'What does the proposal say about');
  await f.say('b', 'the timeline?', 'stale-a');
  assert.deepEqual(questions, ['What does the proposal say about', 'What does the proposal say about the timeline?']);
  assert.match(f.creates().at(-1).response.instructions, /about the timeline\?$/);
  await f.play('r1');
  await f.say('c', 'And the cost?');
  assert.equal(questions.at(-1), 'And the cost?', 'words already answered aloud are not carried again');
});

test('a merged request tells the model that later words may correct earlier ones', async (t) => {
  const f = await live(t, async () => ({
    sources: [{ id: 'S1', title: 'Plan', content: 'Support is weekdays.' }],
    history: [],
    fallback: 'Please message the team.',
  }));
  await f.say('a', 'When is support');
  await f.say('b', 'actually, who provides it?', 'stale-a');
  const prepared = f.creates().at(-1).response;
  assert.equal(prepared.tool_choice.name, 'prepare_answer');
  assert.match(prepared.instructions, /more than one breath/);
  assert.match(prepared.instructions, /When is support actually, who provides it\?/);
});

test('noise after a question does not drop the question', async (t) => {
  const questions = [];
  const f = await live(t, async (question) => {
    questions.push(question);
    return { reply: 'Support is weekdays.', history: [] };
  });
  await f.say('a', 'When is support available?');
  f.socket.event({ type: 'input_audio_buffer.speech_started', item_id: 'cough' });
  f.supersede('stale-a');
  f.socket.event({ type: 'input_audio_buffer.speech_stopped', item_id: 'cough' });
  f.socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'cough', transcript: ' ' });
  await tick();
  await tick();
  assert.deepEqual(questions, ['When is support available?', 'When is support available?']);
  assert.match(f.creates().at(-1).response.instructions, /Support is weekdays/);
});

test('a spoken figure that is not in the evidence falls back instead of being voiced', async (t) => {
  const f = await live(t, async () => ({
    sources: [{ id: 'S1', title: 'Plan', content: 'Support costs $450 per month.' }],
    history: [],
    fallback: 'I cannot confirm that. Please message the team.',
  }));
  await f.say('a', 'How much is support?');
  const answer = (id, text) => {
    const metadata = f.creates().at(-1).response.metadata;
    f.socket.event({ type: 'response.created', response: { id, metadata } });
    f.socket.event({
      type: 'response.done',
      response: {
        id,
        status: 'completed',
        output: [
          {
            type: 'function_call',
            call_id: `call_${id}`,
            name: 'prepare_answer',
            arguments: JSON.stringify({ kind: 'grounded', answered: true, answer: text, sources: ['S1'] }),
          },
        ],
      },
    });
  };
  answer('wrong', 'Support costs $540 per month.');
  await tick();
  await tick();
  assert.match(f.creates().at(-1).response.instructions, /cannot confirm/);
  assert.ok(!f.creates().at(-1).response.instructions.includes('540'));
});
