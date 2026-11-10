import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptionPrompt } from '../server/vexbot/speech.mjs';
import { selectedFile, selectedMessage } from '../server/vexbot/portal-context.mjs';
import {
  localWakeAvailable,
  matchesWakePhrase,
  WakeWordListener,
} from '../src/vexbot/wake-word.ts';
import { createProvider } from '../server/vexbot/provider.mjs';
import { directBusinessAnswer, followUpClarification, VOICE_NO_ANSWER } from '../server/vexbot/direct-answer.mjs';

test('unanswered ordinal follow-ups clarify briefly and voice does not repeat a long contact script', () => {
  assert.equal(followUpClarification('Tell me more about the second point.'), 'Which point do you mean?');
  assert.equal(followUpClarification('What are your support hours?'), '');
  assert.ok(VOICE_NO_ANSWER.split(/\s+/).length < 25);
});

test('only an unambiguous single profile field skips generation; compound questions retain the model path', () => {
  const profile = { hours: '9am–5pm, Monday to Friday, New Zealand time.' };
  assert.equal(directBusinessAnswer('What are your support hours?', profile), profile.hours);
  assert.equal(directBusinessAnswer('What are your support hours and prices?', profile), null);
  assert.equal(directBusinessAnswer('Are you open right now?', profile), null);
  assert.equal(directBusinessAnswer('What are your support hours?', {}), null);
});

test('vocabulary is bounded and is supplied to recorded transcription without rewriting its output', async (t) => {
  assert.ok(
    transcriptionPrompt(
      Array.from({ length: 100 }, (_, i) => ({ name: `${i} <proposal>\n${'x'.repeat(500)}` })),
    ).length <= 1500,
  );
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  globalThis.fetch = async (_, init) => {
    assert.equal(init.body.get('language'), 'en');
    assert.match(init.body.get('prompt'), /Smart Express/);
    return Response.json({ text: 'Uncertain name as actually heard' });
  };
  const provider = createProvider({
    OPENAI_API_KEY: 'synthetic',
    VEXBOT_OPENAI_MODEL: 'model',
    VEXBOT_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
  });
  assert.equal(
    await provider.transcribe(Buffer.from('audio'), 'audio/wav'),
    'Uncertain name as actually heard',
  );
});

test('message references clarify without selection and cannot cross workspace boundaries', async () => {
  const id = '11111111-1111-4111-8111-111111111111',
    thread = '22222222-2222-4222-8222-222222222222';
  let scope;
  const db = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          if (key === 'portal_conversations.workspace_id') scope = value;
          return q;
        },
        async maybeSingle() {
          return {
            data:
              table === 'portal_messages' && scope === 'workspace-a'
                ? {
                    id,
                    body: 'The proposed milestone needs approval.',
                    conversation_id: thread,
                    portal_conversations: { id: thread, subject: 'Milestone', workspace_id: scope },
                  }
                : null,
          };
        },
      };
      return q;
    },
  };
  assert.match(
    (await selectedMessage(db, 'workspace-a', {}, 'Read that message')).reply,
    /Which message/,
  );
  assert.equal(await selectedMessage(db, 'workspace-a', {}, 'Support hours?'), null);
  assert.match(
    (await selectedMessage(db, 'workspace-a', { message_id: id }, 'Read this message')).reply,
    /proposed milestone needs approval/,
  );
  await assert.rejects(
    selectedMessage(db, 'workspace-b', { message_id: id }, 'Read this message'),
    /not available/,
  );
  assert.throws(() => selectedFile({ files: [] }, { file_id: id }), /not available/);
});

test('wake detection accepts the explicit phrase and has no cloud recognition fallback', async (t) => {
  for (const text of ['Hey Vexbot!', 'Hey Vex bot, wake up.'])
    assert.equal(matchesWakePhrase(text), true);
  for (const text of ['Vexbot', 'Hey Vexora', 'They vexbot', 'Hey Vexbotanical'])
    assert.equal(matchesWakePhrase(text), false);
  const previous = globalThis.window;
  t.after(() => {
    globalThis.window = previous;
  });
  globalThis.window = {
    isSecureContext: true,
    webkitSpeechRecognition: class {
      constructor() {
        throw new Error('Cloud fallback must never run');
      }
    },
  };
  assert.equal(await localWakeAvailable(), false);
  let latest,
    activations = 0;
  class LocalRecognition {
    static async available(options) {
      assert.equal(options.processLocally, true);
      return 'available';
    }
    constructor() {
      latest = this;
    }
    start() {
      assert.equal(this.processLocally, true);
    }
    abort() {
      this.aborted = true;
    }
  }
  window.SpeechRecognition = LocalRecognition;
  const listener = new WakeWordListener(
    () => {
      activations++;
    },
    () => {},
  );
  await listener.start();
  const callback = latest.onresult;
  callback({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Hey Vexbot' } }] });
  assert.equal(activations, 1);
  assert.equal(latest.aborted, true);
  assert.equal(latest.onresult, null);
  const cancelled = new WakeWordListener(
    () => {
      throw new Error('Cancelled listener activated');
    },
    () => {},
  );
  const pending = cancelled.start();
  cancelled.stop();
  await assert.rejects(pending, /unavailable/);
});
