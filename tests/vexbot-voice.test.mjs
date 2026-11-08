import test from 'node:test';
import assert from 'node:assert/strict';
import { playReply } from '../src/vexbot/voice.ts';

const speech = { audio: Buffer.from('test audio').toString('base64'), mime: 'audio/mpeg' };

test('voice playback rejects autoplay and media failures rather than reporting completion', async () => {
  const blocked = { play: () => Promise.reject(new Error('NotAllowedError')), pause() {} };
  await assert.rejects(playReply(blocked, speech).done, /Check site sound permissions/);
  const broken = { play: () => Promise.resolve(), pause() {} };
  const playback = playReply(broken, speech);
  broken.onerror();
  await assert.rejects(playback.done, /Audio playback failed/);
});

test('End settles pending playback and pauses the player; normal completion also settles', async () => {
  let paused = false;
  const player = { play: () => Promise.resolve(), pause() { paused = true; } };
  const playback = playReply(player, speech);
  playback.stop();
  await playback.done;
  assert.equal(paused, true);
  assert.equal(player.onended, null);
  assert.equal(player.onerror, null);
  const next = playReply(player, speech);
  player.onended();
  await next.done;
});
