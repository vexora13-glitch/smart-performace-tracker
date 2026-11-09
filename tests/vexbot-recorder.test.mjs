import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnRecorder } from '../src/vexbot/voice.ts';

test('recorder cancels delayed permission, mutes tracks, resumes and releases resources on failure', async t => {
  const keys = ['window', 'navigator', 'MediaRecorder'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => keys.forEach((key, i) => originals[i] ? Object.defineProperty(globalThis, key, originals[i]) : delete globalThis[key]));
  let resolvePermission;
  let stopped = 0;
  const track = { enabled: true, stop() { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/webm';
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
  }
  Object.defineProperty(globalThis, 'window', {configurable:true,value:{isSecureContext:true,setTimeout,clearTimeout}});
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{resolvePermission=resolve;})}}});
  Object.defineProperty(globalThis, 'MediaRecorder', {configurable:true,writable:true,value:Recorder});
  const pending = new TurnRecorder();
  const start = pending.start(() => {});
  pending.cancel(); resolvePermission(stream);
  await assert.rejects(start, e => e === 'failed');
  assert.equal(stopped, 1, 'late-granted microphone must stop');
  navigator.mediaDevices.getUserMedia = async () => stream;
  const active = new TurnRecorder();
  await active.start(() => {});
  active.mute(true); assert.equal(track.enabled, false);
  active.mute(false); assert.equal(track.enabled, true);
  await active.stop(); assert.equal(stopped, 2);
  const broken = new TurnRecorder();
  globalThis.MediaRecorder = class extends Recorder { start() { throw new Error('device lost'); } };
  await assert.rejects(broken.start(() => {}), /device lost/);
  assert.equal(stopped, 3, 'recorder failure must stop microphone');
});
