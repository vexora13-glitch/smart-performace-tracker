// Opt-in REAL provider protocol check. No physical microphone, no listening claim.
// Synthetic reference data only. Uses the portal's existing local server key.
import { chromium } from '@playwright/test';
import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCall, portalRealtimeSession, supervise, hangUp } from '../server/vexbot/realtime.mjs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';

if (!process.argv.includes('--live')) throw new Error('Pass --live to authorise a small billable provider check.');
Object.assign(process.env, loadEnv('development', process.cwd(), ''));
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is unavailable.');
const browser = await chromium.launch({ channel: 'chrome' });
let call, supervisor;
const events = [], messages = [];
class DiagnosticSocket extends WebSocket {
  constructor(...args) {
    super(...args);
    this.on('message', data => {
      const event = JSON.parse(String(data));
      if (event.type === 'session.updated') {
        const { model, audio, tool_choice, tools, max_output_tokens } = event.session;
        events.push({ type: 'verified_config', model, audio, tool_choice, tools, max_output_tokens });
      }
      if (event.type === 'error') console.log(JSON.stringify({ providerError: event.error?.code, param: event.error?.param }));
    });
  }
}
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const offer = await page.evaluate(async () => {
    const peer = new RTCPeerConnection(); window.peer = peer;
    peer.addTransceiver('audio', { direction: 'sendrecv' });
    const channel = peer.createDataChannel('oai-events'); window.channel = channel;
    window.events = [];
    channel.onmessage = e => window.events.push(JSON.parse(e.data));
    const audio = new Audio(); audio.autoplay = true;
    peer.ontrack = e => { audio.srcObject = e.streams[0]; void audio.play().catch(() => {}); };
    await peer.setLocalDescription(await peer.createOffer());
    return peer.localDescription.sdp;
  });
  const config = portalRealtimeSession([]);
  const context = {
    async refresh() {}, async evidence() {},
    async lookup() { return { sources: [{ id: 'S1', kind: 'document', document_id: 'synthetic', title: 'Synthetic protocol check', content: 'The synthetic project is a client portal. It is proposed, not completed. Vexora builds custom software and connected systems.' }], history: [], notes: [], fallback: 'I cannot confirm that. Please message the team.' }; },
    async userMessage(text) { messages.push({ role: 'user', text }); },
    async assistantMessage(text, sources, interrupted) { messages.push({ role: 'assistant', text, sourceIds: sources.map(s => s.id), interrupted }); },
    async snapshot() { return { conversation: { id: 'synthetic' }, messages }; },
  };
  call = await createCall(offer, config, 'synthetic-protocol-check');
  supervisor = supervise({ callId: call.callId, session: config, context, emit: e => events.push(e.type), seconds: 55, Socket: DiagnosticSocket });
  await supervisor.ready;
  await page.evaluate(sdp => window.peer.setRemoteDescription({ type: 'answer', sdp }), call.answer);
  await page.waitForFunction(() => window.channel.readyState === 'open', null, { timeout: 15000 });
  await page.evaluate(() => {
    window.channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: "Tell me about the project we're working on." }] } }));
  });
  supervisor.beginTurn();
  await page.waitForFunction(() => window.events.some(e => e.type === 'output_audio_buffer.stopped'), null, { timeout: 40000 });
  const types = await page.evaluate(() => window.events.map(e => e.type));
  const spoken = await page.evaluate(() => window.events.filter(e => e.type === 'response.output_audio_transcript.done').map(e => e.transcript));
  const result = await supervisor.finish('provider-check');
  assert.ok(spoken.length > 0);
  assert.ok(!spoken.some(text => /I.m (?:sharing|preparing|reading)|spoken answer|approved reply/i.test(text)), 'No internal workflow narration in spoken output');
  const report = { at: new Date().toISOString(), model: config.model, voice: config.audio.output.voice, method: 'Real provider WebRTC and sideband; synthetic text input and knowledge. No physical microphone or human listening.', events: [...new Set(types)], messages, spokenTranscripts: spoken, usage: result, liveListening: 'PENDING', acousticMatch: 'NOT EVALUATED' };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/vexbot-realtime-provider-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ model: config.model, voice: config.audio.output.voice, receivedAudioBufferEvents: types.includes('output_audio_buffer.started'), savedReplies: messages.length, terminated: result.terminated }));
} finally {
  if (supervisor) await supervisor.finish('cleanup');
  else if (call) await hangUp(call.callId);
  await browser.close();
}
