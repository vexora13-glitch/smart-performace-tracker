// AI provider for Vexbot: grounded answers, speech-to-text and text-to-speech. The OpenAI adapter uses the
// portal's own server-only key. The mock is deterministic, labelled, and refused on Vercel production; it
// exists so the whole flow can be built and tested locally without a key.
import { ANSWER_SCHEMA, systemPrompt, userPrompt } from './prompt.mjs';

const OPENAI = 'https://api.openai.com/v1';

async function openai(env, path, init) {
  const response = await fetch(`${OPENAI}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(45000),
  });
  // Only the status is kept: it tells whether the key, the model name or a rate limit is at fault.
  if (!response.ok) throw Object.assign(new Error(`Provider request failed (${response.status})`), { status: response.status });
  return response;
}

function openaiProvider(env) {
  const model = env.VEXBOT_OPENAI_MODEL;
  return {
    name: 'openai',
    voice: Boolean(env.VEXBOT_TRANSCRIBE_MODEL && env.VEXBOT_TTS_MODEL),
    async answer({ settings, question, sources, history }) {
      const response = await openai(env, '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          store: false,
          messages: [
            { role: 'system', content: systemPrompt(settings) },
            { role: 'user', content: userPrompt({ question, sources, history }) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'vexbot_answer', strict: true, schema: ANSWER_SCHEMA } },
        }),
      });
      const data = await response.json();
      // An unreadable reply is a service failure, not a sign that the sources lack the answer.
      try { return JSON.parse(data.choices?.[0]?.message?.content ?? ''); } catch { throw new Error('Provider returned an unreadable answer'); }
    },
    async transcribe(audio, mime) {
      const form = new FormData();
      form.append('model', env.VEXBOT_TRANSCRIBE_MODEL);
      form.append('file', new Blob([audio], { type: mime }), `turn.${mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'm4a'}`);
      const response = await openai(env, '/audio/transcriptions', { method: 'POST', body: form });
      return String((await response.json()).text ?? '').trim();
    },
    async speak(text) {
      const response = await openai(env, '/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.VEXBOT_TTS_MODEL, voice: env.VEXBOT_TTS_VOICE || 'alloy', input: text, response_format: 'mp3' }),
      });
      return { audio: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg' };
    },
  };
}

/** A short sine tone as WAV, standing in for synthesised speech in local tests. */
function tone(seconds = 0.6) {
  const rate = 8000, samples = Math.round(rate * seconds), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000 * Math.min(1, (samples - i) / 400)), 44 + i * 2);
  return buffer;
}

function mockProvider(env) {
  return {
    name: 'mock',
    voice: true,
    // Extractive: quotes the best-ranked passage. Never invents content and declines with no sources.
    async answer({ question, sources }) {
      // A file the client asked about: summarise by quoting its opening, or the sentence that matches.
      const file = sources.find((source) => source.whole);
      if (file) {
        const sentences = file.content.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
        const generic = new Set(['what', 'does', 'this', 'that', 'there', 'document', 'file', 'about', 'tell', 'with', 'from', 'here']);
        const asked = (question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !generic.has(word) && !file.title.toLowerCase().includes(word));
        const match = /summar|overview|what(?:'s| is) in/i.test(question) ? null : sentences.find((part) => asked.some((word) => part.toLowerCase().includes(word)));
        return { answered: true, answer: `Summary of "${file.title}": ${match ?? sentences.slice(0, 3).join(' ')}`.slice(0, 1200), sources: [file.id] };
      }
      const words = new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
      const ranked = sources.map((source) => ({ source, hits: [...words].filter((word) => source.content.toLowerCase().includes(word)).length })).filter((row) => row.hits > 0).sort((a, b) => b.hits - a.hits);
      if (!ranked.length) return { answered: false, answer: '', sources: [] };
      const best = ranked[0].source;
      const sentence = best.content.split(/(?<=[.!?])\s+/).find((part) => [...words].some((word) => part.toLowerCase().includes(word))) ?? best.content.slice(0, 280);
      return { answered: true, answer: `According to "${best.title}": ${sentence.trim()}`, sources: [best.id] };
    },
    async transcribe(audio) {
      if (!audio.length) return '';
      return env.VEXBOT_MOCK_TRANSCRIPT || 'What are your support hours?';
    },
    async speak() { return { audio: tone(), mime: 'audio/wav' }; },
  };
}

// Mocks are for local stacks only: every Vercel deployment (preview included) uses the hosted database.
export const onVercel = (env) => Boolean(env.VERCEL || env.VERCEL_ENV);

/** What answers and voice still need, by variable name only (never values). Shown to staff, not clients. */
export function providerSetup(env = process.env) {
  if (env.VEXBOT_PROVIDER === 'mock' && !onVercel(env)) return { mode: 'mock', missing: [] };
  const missing = ['OPENAI_API_KEY', 'VEXBOT_OPENAI_MODEL', 'VEXBOT_TRANSCRIBE_MODEL', 'VEXBOT_TTS_MODEL'].filter((name) => !env[name]);
  return { mode: 'openai', missing };
}

export function createProvider(env = process.env) {
  if (env.OPENAI_API_KEY && env.VEXBOT_OPENAI_MODEL && env.VEXBOT_PROVIDER !== 'mock') return openaiProvider(env);
  if (env.VEXBOT_PROVIDER === 'mock' && !onVercel(env)) return mockProvider(env);
  return null;
}
