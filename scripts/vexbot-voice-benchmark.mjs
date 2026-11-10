// Billable, synthetic LOCAL benchmark. Never points the portal at a hosted database.
// Run before/after with the same cached input audio. Provider buffer events are
// transport proxies, not physical speaker/microphone or human accent measurements.
import './require-portal-checkout.mjs';
import { chromium } from '@playwright/test';
import { loadEnv } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

if (!process.argv.includes('--live'))
  throw new Error('Use --live for a billable synthetic benchmark.');
const label = process.argv.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'after';
const website = process.argv.includes('--website');
const identityOnly = process.argv.includes('--identity');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid output label.');
const env = loadEnv('development', process.cwd(), ''),
  local = loadEnv('localtest', process.cwd(), '');
if (!['localhost', '127.0.0.1'].includes(new URL(local.SUPABASE_URL).hostname))
  throw new Error('Local database required.');
if (!env.OPENAI_API_KEY) throw new Error('Server API key unavailable.');
const dir = resolve('artifacts/voice-upgrade');
const sourceFingerprints = Object.fromEntries(await Promise.all(['server/vexbot/realtime.mjs', 'server/vexbot/handler.mjs', 'src/vexbot/realtime.ts'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await mkdir(dir, { recursive: true });
const questions = [
  'What are your support hours?',
  'Can you explain that in simpler terms?',
  'Summarise pike point.pdf.',
  'Tell me more about the second point.',
  'What does that message say?',
  'What are your support hours?',
];
const inputs = [];
for (let i = 0; i < questions.length; i++) {
  const path = resolve(dir, `input-${i}.wav`);
  let audio;
  try {
    audio = await readFile(path);
  } catch {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: questions[i],
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`Synthetic input failed (${r.status}).`);
    audio = Buffer.from(await r.arrayBuffer());
    await writeFile(path, audio);
  }
  inputs.push(audio.toString('base64'));
}
const server = website
  ? null
  : spawn(process.execPath, ['scripts/dev.mjs', '--localtest'], {
      windowsHide: true,
      env: {
        ...process.env,
        ...local,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        VEXBOT_PROVIDER: 'openai',
        VEXBOT_REALTIME_ENABLED: 'true',
        PORTAL_DEV_PORT: '5193',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
let logs = '';
server?.stdout.on('data', (d) => {
  logs += d;
});
server?.stderr.on('data', (d) => {
  logs += d;
});
let browser, page;
const turns = [];
const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
function wer(expected, actual) {
  const a = normalise(expected),
    b = normalise(actual),
    row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] !== b[j - 1]));
      previous = old;
    }
  }
  return row[b.length] / a.length;
}
const summary = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) /
        2
      : null,
    p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  };
};
try {
  if (!website)
    for (let i = 0; i < 100; i++) {
      if (
        await fetch('http://localhost:5193')
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await new Promise((r) => setTimeout(r, 200));
    }
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  page = await browser.newPage();
  await page.addInitScript(() => {
    window.bench = { events: [], turns: [], mic: null };
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(),
        dest = ctx.createMediaStreamDestination();
      await ctx.resume();
      // Keep silence frames flowing between utterances; an inactive destination
      // can stop sending RTP and prevent the provider's VAD seeing trailing silence.
      const silence = ctx.createConstantSource();
      silence.offset.value = 0;
      silence.connect(dest);
      silence.start();
      window.bench.silence = silence;
      window.bench.ctx = ctx;
      window.bench.dest = dest;
      window.bench.mic = performance.now();
      return dest.stream;
    };
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channel.addEventListener('message', (e) => {
          const value = JSON.parse(String(e.data));
          if (value.session)
            window.bench.config = {
              model: value.session.model,
              voice: value.session.audio?.output?.voice,
              transcription: value.session.audio?.input?.transcription?.model,
            };
          window.bench.events.push({
            at: performance.now(),
            type: value.type,
            item: value.item_id,
            response: value.response_id ?? value.response?.id,
            transcript: value.transcript,
            delta: value.delta,
            code: value.error?.code,
          });
        });
        return channel;
      }
    };
  });
  if (website) await page.goto('https://www.vexoradigital.com');
  else {
    const seed = JSON.parse(await readFile('artifacts/vexbot-seed.json', 'utf8'));
    await page.goto('http://localhost:5193');
    await page.locator('input[name=email]').fill(seed.alice.email);
    await page.locator('input[name=password]').fill(seed.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  const launcher = page.getByTestId(website ? 'companion-launcher' : 'vexbot-talk');
  await launcher.waitFor();
  if (website) await page.locator('[data-testid="companion"][data-voice="true"]').waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(600);
  const clicked = await page.evaluate(() => performance.now());
  await launcher.click();
  await page.waitForFunction(
    () => window.bench.events.some((e) => e.type === 'output_audio_buffer.stopped'),
    null,
    { timeout: 35000 },
  );
  const activation = await page.evaluate(
    (clicked) => ({
      micMs: window.bench.mic - clicked,
      readyMs: window.bench.events.find((e) => e.type === 'session.created').at - clicked,
    }),
    clicked,
  );
  for (let i = 0; i < (identityOnly ? 0 : inputs.length); i++) {
    await page.waitForTimeout(750);
    const playback = await page.evaluate(async (audio) => {
      const b = window.bench,
        bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
      const buffer = await b.ctx.decodeAudioData(bytes.buffer);
      const node = b.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(b.dest);
      const at = performance.now();
      node.start();
      const turn = { at, end: at + buffer.duration * 1000 };
      b.turns.push(turn);
      return turn;
    }, inputs[i]);
    let failure = null;
    try {
      await page.waitForFunction(
        (at) =>
          window.bench.events.some((e) => e.at > at && e.type === 'output_audio_buffer.stopped'),
        playback.at,
        { timeout: 35000 },
      );
    } catch {
      failure = 'No completed playback within 35 seconds';
    }
    const events = await page.evaluate(
      (at) => window.bench.events.filter((e) => e.at > at),
      playback.at,
    );
    const at = (type) => events.find((e) => e.type === type)?.at;
    const transcript =
      events.find((e) => e.type === 'conversation.item.input_audio_transcription.completed')
        ?.transcript ?? '';
    turns.push({
      question: questions[i],
      transcript,
      wer: transcript ? wer(questions[i], transcript) : null,
      failure,
      endDetectionMs: at('input_audio_buffer.speech_stopped') - playback.end,
      firstAudioMs: at('output_audio_buffer.started') - playback.end,
      firstTextMs: at('response.output_audio_transcript.delta') - playback.end,
      completionMs: at('output_audio_buffer.stopped') - playback.end,
      endToEndMs: at('output_audio_buffer.stopped') - playback.at,
      inputDurationMs: playback.end - playback.at,
      responseRounds: events.filter((e) => e.type === 'response.created').length,
      events,
    });
    console.log(
      JSON.stringify({
        label,
        turn: i + 1,
        firstAudioMs: turns.at(-1).firstAudioMs,
        responseRounds: turns.at(-1).responseRounds,
        failure,
      }),
    );
    if (failure) break;
  }
  if (!website) {
    await page.getByTestId('vexbot-talk-chat').click();
    await page.getByTestId('vexbot-panel').waitFor();
  }
  await writeFile(
    resolve(dir, `${label}.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        method: `${website ? 'Unmodified public website at www.vexoradigital.com' : 'Local portal API/Auth/database'}; real OpenAI WebRTC; cached synthetic speech via WebAudio. Microphone metric measures a synthetic stream. First audio is provider output-buffer-start, not acoustic output. Small-sample nearest-rank p95.`,
        configuration: await page.evaluate(() => window.bench.config),
        sourceFingerprints: website ? undefined : sourceFingerprints,
        activation,
        failures: turns.filter((t) => t.failure).length,
        turns,
        metrics: Object.fromEntries(
          [
            'endDetectionMs',
            'firstAudioMs',
            'firstTextMs',
            'completionMs',
            'endToEndMs',
            'wer',
          ].map((k) => [k, summary(turns.map((t) => t[k]))]),
        ),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const diagnostic = await page
    ?.evaluate(() => ({
      events: window.bench?.events,
      status: document.querySelector('[data-testid="companion-voice-status"]')?.textContent,
      notice: document.querySelector('[data-testid="companion-notice"]')?.textContent,
    }))
    .catch(() => null);
  await writeFile(
    resolve(dir, `${label}-failure.json`),
    JSON.stringify({ error: error.message, diagnostic }, null, 2),
  );
  console.error(JSON.stringify(diagnostic));
  console.error(logs.slice(-1500));
  throw error;
} finally {
  await page
    ?.getByTestId(website ? 'companion-end' : 'vexbot-talk-end')
    .click({ timeout: 1000 })
    .catch(() => {});
  await browser?.close();
  server?.kill();
}
