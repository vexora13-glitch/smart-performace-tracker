// Native browser WebRTC; microphone and playback never pass through the portal server.
// The authenticated NDJSON stream keeps the server-side supervisor alive and carries
// authorised transcripts/citations. Closing either connection ends the call.
import { primeAudio } from './voice.ts';

export type LiveState =
  'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting';
type Event = { type: string; [key: string]: any }; // Provider events are validated at the boundary below.
type Options = {
  token(): Promise<string>;
  workspace: string | null;
  conversation: string | null;
  context?: { page?: string; file_id?: string; message_id?: string; thread_id?: string };
  state(value: LiveState): void;
  transcript(role: 'user' | 'assistant', text: string): void;
  snapshot(value: Event): void;
  ended(reason: string): void;
  playbackBlocked(blocked: boolean): void;
  openFile?(id: string): void;
};

export function realtimeBlocked() {
  return !window.isSecureContext
    ? 'Voice needs HTTPS or localhost.'
    : !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined'
      ? 'This browser does not support live voice. Choose recorded voice or text.'
      : '';
}

export class RealtimeVoice {
  private options: Options;
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private audio: HTMLAudioElement;
  private abort = new AbortController();
  private sessionId: string | null = null;
  private bearer = '';
  private ended = false;
  private started = false;
  private muted = false;
  private speaking = false;
  private hearing = false;
  private processing = false;
  private reconnecting = false;
  private connected = false;
  private interrupted = false;
  private inputItem = '';
  private inputTranscript = '';
  private blocked = false;
  private responseId = '';
  private stale = new Set<string>();
  private transcript = '';
  private connectTimer = 0;
  private sessionTimer = 0;
  private disconnectTimer = 0;
  private releaseLock: (() => void) | null = null;
  private readDone: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private onLeave = () => {
    void this.close('Voice ended when you left the page.');
  };
  private onDeviceChange = () => {
    if (this.stream?.getAudioTracks().some((t) => t.readyState === 'ended'))
      void this.close('Microphone disconnected. Select your microphone and restart voice.');
  };

  constructor(options: Options) {
    this.options = options;
    this.audio = primeAudio(); // Called synchronously in the user's click, including on mobile.
    this.audio.autoplay = true;
    this.audio.setAttribute('playsinline', '');
  }

  async start() {
    if (this.started || this.ended) return;
    this.started = true;
    try {
      const blocked = realtimeBlocked();
      if (blocked) throw new Error(blocked);
      if (navigator.locks) {
        const acquired = await new Promise<boolean>((resolve) => {
          void navigator.locks
            .request('vexora-portal-live-voice', { ifAvailable: true }, (lock) => {
              if (!lock || this.ended) {
                resolve(false);
                return;
              }
              resolve(true);
              return new Promise<void>((release) => {
                this.releaseLock = release;
              });
            })
            .catch(() => resolve(false));
        });
        if (!acquired) throw new Error('Voice is already open in another tab.');
      }
      if (this.ended) return;
      this.options.state('connecting');
      const authorization = this.options.token().then(
        (token) => ({ token, error: null }),
        (error) => ({ token: '', error }),
      );
      this.connectTimer = window.setTimeout(
        () => void this.close('Voice connection timed out. Retry voice or choose recorded voice.'),
        30000,
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.ended) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !this.muted;
      });
      for (const track of stream.getTracks()) track.onended = this.onDeviceChange;
      navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
      window.addEventListener('pagehide', this.onLeave);
      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.ontrack = (event) => {
        this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.resumeAudio();
      };
      peer.onconnectionstatechange = () => {
        if (this.ended) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed')
          void this.close('Voice connection lost. Restart voice to reconnect.');
        if (peer.connectionState === 'disconnected') {
          this.reconnecting = true;
          this.options.state('reconnecting');
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = window.setTimeout(
            () => void this.close('Voice connection lost. Restart voice to reconnect.'),
            8000,
          );
        } else if (peer.connectionState === 'connected') {
          this.reconnecting = false;
          clearTimeout(this.disconnectTimer);
          this.updateState();
        }
      };
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onopen = () => {
        this.connected = true;
        clearTimeout(this.connectTimer);
        this.updateState();
      };
      channel.onclose = () => {
        void this.close('Voice connection ended.');
      };
      channel.onmessage = (event) => {
        try {
          this.onEvent(JSON.parse(String(event.data)));
        } catch {
          /* Ignore malformed provider events. */
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      // Match the reference's immediate SDP exchange. WebRTC handles connectivity;
      // waiting for ICE gathering here delayed every call by up to two seconds.
      if (this.ended) return;
      const auth = await authorization;
      if (auth.error) throw auth.error;
      if (this.ended) return;
      this.bearer = auth.token;
      const response = await fetch('/api/vexbot-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.bearer}` },
        body: JSON.stringify({
          sdp: peer.localDescription?.sdp,
          workspace_id: this.options.workspace,
          conversation_id: this.options.conversation,
          portal_context: this.options.context,
        }),
        signal: this.abort.signal,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || 'Live voice could not connect.');
      if (!response.body) throw new Error('Live voice supervision is unavailable in this browser.');
      this.readDone = this.read(response.body);
      void this.readDone.catch(() => {
        if (!this.ended)
          void this.close('Voice supervision disconnected. Restart voice to reconnect.');
      });
    } catch (error) {
      const name = (error as DOMException).name;
      await this.close(
        name === 'NotAllowedError'
          ? 'Microphone blocked. Allow microphone access in your browser, then restart voice.'
          : name === 'NotFoundError'
            ? 'No microphone found. Connect one and restart voice.'
            : (error as Error).message,
      );
    }
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 2_000_000) throw new Error('Invalid voice stream.');
        let index;
        while ((index = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Event;
          if (event.type === 'ready') {
            this.sessionId = event.session_id;
            this.options.snapshot(event);
            if (this.ended) {
              void this.endRemote();
              continue;
            }
            this.sessionTimer = window.setTimeout(
              () => void this.close('Voice reached its four-minute limit. Restart to continue.'),
              event.seconds * 1000,
            );
            await this.peer?.setRemoteDescription({ type: 'answer', sdp: event.answer });
          } else if (event.type === 'snapshot') this.options.snapshot(event);
          else if (event.type === 'open_file' && typeof event.file_id === 'string')
            this.options.openFile?.(event.file_id);
          else if (event.type === 'ended') {
            // Do not await close here: close may itself be waiting for this stream to drain.
            void this.close(
              event.reason === 'duration'
                ? 'Voice reached its four-minute limit. Restart to continue.'
                : event.reason === 'idle'
                  ? 'Voice ended after a quiet period.'
                  : 'Voice ended. Restart voice to continue.',
            );
          }
        }
      }
      if (!this.ended)
        void this.close('Voice supervision disconnected. Restart voice to reconnect.');
    } finally {
      reader.releaseLock();
    }
  }

  private send(event: object) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }
  interrupt() {
    if (this.responseId) this.stale.add(this.responseId);
    this.audio.muted = true;
    this.speaking = false;
    this.transcript = '';
    this.processing = false;
    this.interrupted = !this.hearing;
    this.send({ type: 'response.cancel' });
    // WebRTC clear performs provider-managed truncation at its actual playback position.
    // Never invent audio_end_ms with a timer or send a second manual truncate.
    this.send({ type: 'output_audio_buffer.clear' });
    this.options.transcript('assistant', '');
    this.updateState();
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !value;
    });
    this.hearing = false;
    this.send({ type: 'input_audio_buffer.clear' });
    this.updateState();
  }
  async resumeAudio() {
    if (this.ended) return;
    try {
      await this.audio.play();
      this.blocked = false;
      this.options.playbackBlocked(false);
      this.updateState();
    } catch {
      this.blocked = true;
      this.options.playbackBlocked(true);
      this.updateState();
    }
  }
  private updateState() {
    if (!this.ended)
      this.options.state(
        this.reconnecting
          ? 'reconnecting'
          : !this.connected
            ? 'connecting'
            : this.hearing && !this.muted
              ? 'hearing'
              : this.speaking && !this.blocked
                ? 'speaking'
                : this.processing
                  ? 'thinking'
                  : this.interrupted
                    ? 'interrupted'
                    : 'listening',
      );
  }
  private onEvent(event: Event) {
    if (this.ended) return;
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (!this.muted) {
          this.inputItem = event.item_id ?? '';
          this.inputTranscript = '';
          this.options.transcript('user', '');
          this.hearing = true;
          this.interrupt();
        }
        break;
      case 'input_audio_buffer.speech_stopped':
        if (!this.muted) {
          this.hearing = false;
          this.processing = true;
          this.interrupted = false;
          this.updateState();
        }
        break;
      case 'response.created':
        this.responseId = event.response?.id ?? '';
        if (this.hearing) {
          this.stale.add(this.responseId);
          break;
        }
        this.transcript = '';
        this.processing = true;
        this.interrupted = false;
        this.updateState();
        break;
      case 'output_audio_buffer.started':
        if (this.stale.has(event.response_id) || this.hearing) break;
        this.audio.muted = false;
        this.speaking = true;
        this.processing = false;
        this.interrupted = false;
        void this.resumeAudio();
        this.updateState();
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (event.response_id && event.response_id !== this.responseId) break;
        this.speaking = false;
        this.updateState();
        break;
      case 'response.output_audio_transcript.delta':
        if (this.stale.has(event.response_id) || this.hearing) break;
        this.transcript += typeof event.delta === 'string' ? event.delta : '';
        this.options.transcript('assistant', this.transcript);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (
          (!this.inputItem || event.item_id === this.inputItem) &&
          typeof event.transcript === 'string'
        )
          this.options.transcript('user', event.transcript);
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (event.item_id === this.inputItem && typeof event.delta === 'string') {
          this.inputTranscript += event.delta;
          this.options.transcript('user', this.inputTranscript);
        }
        break;
      case 'response.done':
        if (
          event.response?.status === 'cancelled' &&
          !this.speaking &&
          event.response?.id === this.responseId
        ) {
          this.processing = false;
          this.updateState();
        }
        break; // response.done is generation completion, never a playback clock.
      case 'error':
        if (event.error?.code !== 'response_cancel_not_active')
          void this.close('Live voice reported a problem. Retry voice or choose recorded voice.');
        break;
    }
  }
  private async endRemote() {
    if (!this.sessionId || !this.bearer) return;
    await fetch('/api/vexbot-voice', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.bearer}` },
      body: JSON.stringify({ action: 'end', session_id: this.sessionId }),
      signal: AbortSignal.timeout(13000),
    }).catch(() => {});
  }
  close(reason = '') {
    this.closing ??= this.cleanup(reason);
    return this.closing;
  }
  private async cleanup(reason: string) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.connectTimer);
    clearTimeout(this.sessionTimer);
    clearTimeout(this.disconnectTimer);
    window.removeEventListener('pagehide', this.onLeave);
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    this.audio.pause();
    this.audio.srcObject = null;
    this.releaseLock?.();
    this.releaseLock = null;
    this.options.ended(reason);
    // Stop capture/playback immediately, but request provider hangup while its
    // media connection still exists. Closing the peer first races provider teardown.
    await this.endRemote();
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    // Drain authoritative transcript writes before a user continues in text.
    let timer = 0;
    await Promise.race([
      this.readDone,
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, 6000);
      }),
    ]).catch(() => {});
    clearTimeout(timer);
    this.abort.abort();
  }
}
