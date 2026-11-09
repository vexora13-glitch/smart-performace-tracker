// Billable, opt-in LOCAL end-to-end check with real provider audio. Input is
// synthesised speech through Chrome's fake microphone: NOT physical-mic QA or A/B listening.
import { chromium } from '@playwright/test';
import { loadEnv } from 'vite';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--live')) throw new Error('Pass --live for a billable real-provider check using synthetic speech.');
const live = loadEnv('development', process.cwd(), ''), local = loadEnv('localtest', process.cwd(), '');
if (!['127.0.0.1', 'localhost'].includes(new URL(local.SUPABASE_URL).hostname)) throw new Error('Local Supabase is required.');
const key = live.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY is unavailable.');
await mkdir('artifacts', { recursive: true });
const filename = resolve('artifacts/vexbot-realtime-synthetic-input.wav');
// One generated utterance, repeated after a quiet gap, exercises multiple turns.
const audio = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hi VexBot, what are your support hours?', response_format: 'pcm' }),
});
if (!audio.ok) throw new Error(`Synthetic input creation failed (${audio.status}).`);
const pcm = Buffer.from(await audio.arrayBuffer()), rate = 24000;
const silence = seconds => Buffer.alloc(rate * 2 * seconds);
const body = Buffer.concat([silence(2), pcm, silence(14), pcm, silence(40)]);
const wav = Buffer.alloc(44);
wav.write('RIFF', 0); wav.writeUInt32LE(body.length + 36, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(body.length, 40);
await writeFile(filename, Buffer.concat([wav, body]));
const server = spawn(process.execPath, ['scripts/dev.mjs', '--localtest'], { windowsHide: true, env: { ...process.env, ...local, OPENAI_API_KEY: key, VEXBOT_REALTIME_ENABLED: 'true', VEXBOT_PROVIDER: 'openai', PORTAL_DEV_PORT: '5192' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += String(chunk); });
server.stderr.on('data', chunk => { logs += String(chunk); });
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch('http://localhost:5192').then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${filename}`, '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.voiceEvents = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        channel.addEventListener('message', e => {
          const event = JSON.parse(String(e.data));
          window.voiceEvents.push({ type: event.type, at: Date.now(), ...(event.type === 'error' ? { code: event.error?.code } : {}) });
        });
        return channel;
      }
    };
  });
  const seed = JSON.parse(await readFile('artifacts/vexbot-seed.json', 'utf8'));
  const db = createClient(local.SUPABASE_URL, local.SUPABASE_SERVICE_ROLE_KEY);
  await page.goto('http://localhost:5192');
  await page.locator('input[name=email]').fill(seed.alice.email);
  await page.locator('input[name=password]').fill(seed.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('vexbot-talk').waitFor();
  await page.waitForTimeout(500);
  const started = Date.now();
  await page.getByTestId('vexbot-talk').click();
  await page.waitForFunction(() => window.voiceEvents.filter(e => e.type === 'conversation.item.input_audio_transcription.completed').length >= 2 && window.voiceEvents.filter(e => e.type === 'output_audio_buffer.stopped').length >= 2, null, { timeout: 60000 });
  const providerEvents = await page.evaluate(() => window.voiceEvents);
  const reply = await page.getByTestId('vexbot-talk-reply').textContent();
  assert.match(reply, /9|nine|support/i);
  await page.getByTestId('vexbot-talk-mute').click();
  assert.equal(await page.getByTestId('vexbot-talk-mute').getAttribute('aria-pressed'), 'true');
  await page.getByTestId('vexbot-talk-mute').click();
  await page.getByTestId('vexbot-talk-chat').click();
  await page.getByTestId('vexbot-panel').waitFor();
  const transcript = await page.getByTestId('vexbot-log').textContent();
  assert.match(transcript, /support hours/i);
  assert.match(transcript, /Vexora business profile/);
  const client = createClient(local.SUPABASE_URL, local.VITE_SUPABASE_ANON_KEY);
  const signed = await client.auth.signInWithPassword({ email: seed.alice.email, password: seed.password });
  assert.equal(signed.error, null);
  const person = signed.data.user.id;
  let active = [];
  for (let i = 0; i < 100; i++) {
    const result = await db.from('vexbot_voice_sessions').select('id').eq('user_id', person).neq('state', 'ended');
    if (result.error) throw new Error('Session cleanup could not be checked.');
    active = result.data;
    if (!active.length) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(active.length, 0, 'No live server lease remains after returning to text');
  await page.screenshot({ path: 'artifacts/vexbot-realtime-browser.png' });
  const speechStarts = providerEvents.filter(e => e.type === 'input_audio_buffer.speech_started').map(e => e.at - started);
  const speechStops = providerEvents.filter(e => e.type === 'input_audio_buffer.speech_stopped');
  const delays = speechStops.map(stop => providerEvents.find(e => e.type === 'output_audio_buffer.started' && e.at > stop.at)?.at - stop.at).filter(Number.isFinite);
  const report = { at: new Date().toISOString(), method: 'Local portal UI + local Supabase Auth/database + real OpenAI WebRTC/sideband. Synthesised speech input; no physical microphone or human listening.', speechStartsMs: speechStarts, endOfSpeechToOutputBufferMs: delays, eventTypes: [...new Set(providerEvents.map(e => e.type))], providerErrorCodes: providerEvents.filter(e => e.type === 'error').map(e => e.code), providerManagedTruncation: providerEvents.some(e => e.type === 'conversation.item.truncated'), transcribedTurns: providerEvents.filter(e => e.type === 'conversation.item.input_audio_transcription.completed').length, reply, transcript, muteUnmute: 'PASS (UI)', voiceToText: 'PASS', physicalMicrophone: 'PENDING', listeningComparison: 'PENDING' };
  await writeFile('artifacts/vexbot-realtime-browser-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ transcribedTurns: report.transcribedTurns, endOfSpeechToOutputBufferMs: delays, voiceToText: report.voiceToText }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'artifacts/vexbot-realtime-browser-failure.png' }).catch(() => {});
    console.error(await page.getByTestId('vexbot-talk-bubble').textContent().catch(() => 'No voice bubble'));
    const events = await page.evaluate(() => window.voiceEvents).catch(() => []);
    await writeFile('artifacts/vexbot-realtime-browser-failure-events.json', JSON.stringify(events, null, 2));
    console.error(JSON.stringify({ eventTypes: [...new Set(events.map(e => e.type))], errorCodes: events.filter(e => e.code).map(e => e.code) }));
  }
  console.error(logs.slice(-3000));
  throw error;
} finally {
  await page?.getByTestId('vexbot-talk-end').click({ timeout: 1000 }).catch(() => {});
  await browser?.close();
  server.kill();
}
