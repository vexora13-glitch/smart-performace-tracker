// Turn-based voice: record one question, stop, send it for transcription, then (optionally) play the spoken
// reply. It is not a live, full-duplex conversation. Audio is never stored by the portal.

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
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    return 'unsupported';
  return null;
}

export class TurnRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private parts: Blob[] = [];
  private timer = 0;
  private cancelled = false;
  private finished: ((blob: Blob) => void) | null = null;
  mime = '';

  /** Starts recording. Rejects with a VoiceProblem. `onLimit` fires if the turn reaches its time limit. */
  async start(onLimit: () => void) {
    this.cancelled = false;
    const blocked = voiceBlocked();
    if (blocked) throw blocked;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as DOMException).name;
      throw name === 'NotAllowedError' || name === 'SecurityError'
        ? 'denied'
        : name === 'NotFoundError'
          ? 'no-microphone'
          : 'failed';
    }
    if (this.cancelled) {
      this.release();
      throw 'failed';
    }
    try {
      this.mime = TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
      this.recorder = new MediaRecorder(
        this.stream,
        this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : undefined,
      );
      this.mime = this.recorder.mimeType || this.mime || 'audio/webm';
      this.parts = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) this.parts.push(event.data);
      };
      this.recorder.onstop = () => {
        this.release();
        this.finished?.(new Blob(this.parts, { type: this.mime }));
      };
      this.recorder.start(1000);
      this.timer = window.setTimeout(onLimit, MAX_SECONDS * 1000);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  /** Stops and resolves with the recorded turn. */
  stop(): Promise<Blob> {
    window.clearTimeout(this.timer);
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        this.release();
        resolve(new Blob([], { type: this.mime }));
        return;
      }
      this.finished = resolve;
      this.recorder.stop();
    });
  }

  mute(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted && this.recorder?.state === 'recording') this.recorder.pause();
    if (!muted && this.recorder?.state === 'paused') this.recorder.resume();
  }

  cancel() {
    this.cancelled = true;
    window.clearTimeout(this.timer);
    this.finished?.(new Blob([], { type: this.mime }));
    this.finished = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
