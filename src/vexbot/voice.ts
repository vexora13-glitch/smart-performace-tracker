// Voice for Vexbot. Two ways in: the panel's turn-based mic (record, stop, send), and hands-free voice mode
// from the robot (below). Neither is a live, full-duplex stream: each utterance is recorded, transcribed and
// answered in turn. Audio is never stored by the portal.

const MAX_SECONDS = 55;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export type VoiceProblem = 'insecure' | 'unsupported' | 'denied' | 'no-microphone' | 'failed';
export const VOICE_PROBLEMS: Record<VoiceProblem, string> = {
  insecure: 'Voice needs a secure (HTTPS) page. You can type instead.',
  unsupported: "This browser can't record voice. You can type instead.",
  denied: 'Microphone blocked. You can type instead.',
  'no-microphone': 'No microphone found. You can type instead.',
  failed: "Recording didn't start. You can type instead.",
};

/** Known before asking for a microphone, so nothing is requested that couldn't be used. */
export function voiceBlocked(): VoiceProblem | null {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unsupported';
  return null;
}

export class TurnRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private parts: Blob[] = [];
  private timer = 0;
  private finished: ((blob: Blob) => void) | null = null;
  mime = '';

  /** Starts recording. Rejects with a VoiceProblem. `onLimit` fires if the turn reaches its time limit. */
  async start(onLimit: () => void) {
    const blocked = voiceBlocked();
    if (blocked) throw blocked;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      const name = (error as DOMException).name;
      throw name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'no-microphone' : 'failed';
    }
    this.mime = TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : undefined);
    this.mime = this.recorder.mimeType || this.mime || 'audio/webm';
    this.parts = [];
    this.recorder.ondataavailable = (event) => { if (event.data.size) this.parts.push(event.data); };
    this.recorder.onstop = () => { this.release(); this.finished?.(new Blob(this.parts, { type: this.mime })); };
    this.recorder.start(1000);
    this.timer = window.setTimeout(onLimit, MAX_SECONDS * 1000);
  }

  /** Stops and resolves with the recorded turn. */
  stop(): Promise<Blob> {
    window.clearTimeout(this.timer);
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') { this.release(); resolve(new Blob([], { type: this.mime })); return; }
      this.finished = resolve;
      this.recorder.stop();
    });
  }

  cancel() {
    window.clearTimeout(this.timer);
    this.finished = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

// ---- Hands-free voice mode -----------------------------------------------------------------------------------
// The client taps "Talk to Vexbot" once. Vexbot listens, notices when they stop speaking, answers aloud, then
// listens again, until they mute or end it. Each utterance is still a separate recording that is transcribed
// and discarded; nothing is streamed or stored.

export type DetectorStep = 'waiting' | 'started' | 'speaking' | 'ended' | 'idle' | 'limit';

/**
 * Decides from microphone loudness (RMS, 0 to 1) when someone starts and stops speaking. It learns the room's
 * noise floor first, needs a short run of sound to count as speech, and a pause to count as the end.
 */
export class UtteranceDetector {
  startMs = 160;
  endMs = 1100;
  idleMs = 15_000;
  maxMs = MAX_SECONDS * 1000;
  minLevel = 0.012;
  private floor = 0;
  private samples = 0;
  private loudFor = 0;
  private quietFor = 0;
  private elapsed = 0;
  started = false;

  step(rms: number, ms: number): DetectorStep {
    this.elapsed += ms;
    if (this.elapsed <= 300 && !this.started) {
      this.floor = (this.floor * this.samples + rms) / ++this.samples;
      return 'waiting';
    }
    const threshold = Math.max(this.minLevel, this.floor * 3);
    if (!this.started) {
      if (rms > threshold) {
        this.loudFor += ms;
        if (this.loudFor >= this.startMs) { this.started = true; this.quietFor = 0; return 'started'; }
      } else {
        this.loudFor = 0;
        this.floor = this.floor * 0.97 + rms * 0.03;
      }
      return this.elapsed >= this.idleMs ? 'idle' : 'waiting';
    }
    this.quietFor = rms > threshold * 0.7 ? 0 : this.quietFor + ms;
    if (this.quietFor >= this.endMs) return 'ended';
    return this.elapsed >= this.maxMs ? 'limit' : 'speaking';
  }
}

/** An open microphone for a voice session. Released on close; muting disables the track itself. */
export class VoiceSession {
  private stream: MediaStream;
  private context: AudioContext;
  private analyser: AnalyserNode;
  private samples: Float32Array<ArrayBuffer>;
  private stopListening: (() => void) | null = null;
  private unmuted: (() => void)[] = [];
  muted = false;
  closed = false;
  mime = '';

  private constructor(stream: MediaStream) {
    this.stream = stream;
    this.context = new AudioContext();
    void this.context.resume().catch(() => {});
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.context.createMediaStreamSource(stream).connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.mime = TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  }

  /** Asks for the microphone. Rejects with a VoiceProblem. */
  static async open(): Promise<VoiceSession> {
    const blocked = voiceBlocked();
    if (blocked) throw blocked;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      try { return new VoiceSession(stream); }
      catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
    } catch (error) {
      const name = (error as DOMException).name;
      throw name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'no-microphone' : 'failed';
    }
  }

  private level() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) sum += value * value;
    return Math.sqrt(sum / this.samples.length);
  }

  /**
   * Records one utterance: from now until the speaker pauses. Resolves with the recording, or null when no
   * one spoke, the session was muted or ended, or listening was cancelled.
   */
  listen(onSpeech: () => void): Promise<Blob | null> {
    if (this.closed || this.muted) return Promise.resolve(null);
    const recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : undefined);
    const type = recorder.mimeType || this.mime || 'audio/webm';
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    recorder.start(250);
    const detector = new UtteranceDetector();
    return new Promise((resolve) => {
      let last = performance.now();
      const finish = (keep: boolean) => {
        window.clearInterval(timer);
        this.stopListening = null;
        recorder.onstop = () => resolve(keep && parts.length ? new Blob(parts, { type }) : null);
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(null);
      };
      const timer = window.setInterval(() => {
        const now = performance.now();
        const step = detector.step(this.level(), now - last);
        last = now;
        if (step === 'started') onSpeech();
        else if (step === 'ended' || step === 'limit') finish(true);
        else if (step === 'idle') finish(false);
      }, 50);
      this.stopListening = () => finish(false);
    });
  }

  /** Stops the current utterance without sending it. */
  cancel() {
    this.stopListening?.();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) this.cancel();
    else this.unmuted.splice(0).forEach((resume) => resume());
  }

  /** Resolves when the microphone is unmuted, or the session ends. */
  whenUnmuted() {
    return this.muted && !this.closed ? new Promise<void>((resolve) => this.unmuted.push(resolve)) : Promise.resolve();
  }

  close() {
    this.closed = true;
    this.cancel();
    this.unmuted.splice(0).forEach((resume) => resume());
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close().catch(() => {});
  }
}

/** A tiny silent WAV, played during the tap that starts voice mode so later replies may play by themselves. */
function silence() {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  [...'RIFF'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint32(4, 38, true);
  [...'WAVEfmt '].forEach((c, i) => view.setUint8(8 + i, c.charCodeAt(0)));
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  [...'data'].forEach((c, i) => view.setUint8(36 + i, c.charCodeAt(0)));
  view.setUint32(40, 2, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Call synchronously inside the click handler. Returns the audio element that will play every reply. */
export function primeAudio(): HTMLAudioElement {
  const player = new Audio();
  const source = URL.createObjectURL(silence());
  player.src = source;
  void player.play().catch(() => {}).finally(() => URL.revokeObjectURL(source));
  return player;
}

/** Plays a spoken reply on the primed element. `done` settles when it ends, fails or `stop` is called. */
export function playReply(player: HTMLAudioElement, speech: { audio: string; mime: string }) {
  const bytes = Uint8Array.from(atob(speech.audio), (char) => char.charCodeAt(0));
  // A blob: URL, which the portal's Content-Security-Policy allows for media (data: is not).
  const source = URL.createObjectURL(new Blob([bytes], { type: speech.mime }));
  let finish = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = () => { player.onended = player.onerror = null; URL.revokeObjectURL(source); resolve(); };
    player.onended = finish;
    const failed = () => { player.onended = player.onerror = null; URL.revokeObjectURL(source); reject(new Error('Audio playback failed. Check site sound permissions and your output device, then retry Talk.')); };
    player.onerror = failed;
    player.src = source;
    player.play().catch(failed);
  });
  return { done, stop: () => { player.pause(); finish(); } };
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
