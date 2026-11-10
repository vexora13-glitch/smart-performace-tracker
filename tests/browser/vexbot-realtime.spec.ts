import { expect, test } from '@playwright/test';

// Browser transport/lifecycle checks use explicit stand-ins. They do not establish
// real speech recognition, provider latency, audible quality or voice fidelity.
for (const width of [1440, 390])
  test(`Realtime lifecycle at ${width}px (mock transport)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      const w = window as any;
      w.states = [];
      w.transcripts = [];
      w.stoppedTracks = 0;
      const track = {
        enabled: true,
        onended: null,
        stop() {
          w.stoppedTracks++;
        },
      };
      w.track = track;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          async getUserMedia() {
            return { getTracks: () => [track], getAudioTracks: () => [track] };
          },
          addEventListener() {},
          removeEventListener() {},
        },
      });
      class Peer extends EventTarget {
        constructor() {
          super();
          w.peer = this;
        }
        iceGatheringState = 'complete';
        connectionState = 'new';
        localDescription = { sdp: 'v=0\r\n' };
        onconnectionstatechange: (() => void) | null = null;
        addTrack() {}
        createDataChannel() {
          const channel = {
            readyState: 'open',
            send(value: string) {
              w.sent.push(JSON.parse(value));
            },
            close() {},
          };
          w.channel = channel;
          return channel;
        }
        async createOffer() {
          return this.localDescription;
        }
        async setLocalDescription() {}
        async setRemoteDescription() {
          w.channel.onopen();
        }
        close() {
          this.connectionState = 'closed';
        }
      }
      w.RTCPeerConnection = Peer;
      w.sent = [];
      const realFetch = window.fetch;
      w.fetch = (url: string, init: RequestInit) => {
        if (url !== '/api/vexbot-voice') return realFetch(url, init);
        const input = JSON.parse(init.body as string);
        if (input.action === 'end') {
          w.streamControl?.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ type: 'ended', reason: 'client-ended' }) + '\n',
            ),
          );
          w.streamControl?.close();
          return Promise.resolve(Response.json({ ended: true }));
        }
        w.connectionCalls = (w.connectionCalls ?? 0) + 1;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                w.streamControl = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      type: 'ready',
                      answer: 'sdp',
                      session_id: 'synthetic',
                      conversation: { id: 'conv' },
                      seconds: 240,
                    }) + '\n',
                  ),
                );
              },
            }),
          ),
        );
      };
      const { RealtimeVoice } = await import('/src/vexbot/realtime.ts' as string);
      w.live = new RealtimeVoice({
        token: async () => 'synthetic-token',
        workspace: null,
        conversation: null,
        state: (value: string) => w.states.push(value),
        snapshot() {},
        transcript: (role: string, text: string) => w.transcripts.push({ role, text }),
        ended: (reason: string) => (w.ended = reason),
        playbackBlocked() {},
      });
      await w.live.start();
      await w.live.start();
      w.event = (event: object) => w.channel.onmessage({ data: JSON.stringify(event) });
    });
    await expect.poll(() => page.evaluate(() => (window as any).states.at(-1))).toBe('listening');
    expect(await page.evaluate(() => (window as any).connectionCalls)).toBe(1);
    await page.evaluate(async () => {
      const w = window as any;
      w.event({ type: 'response.created', response: { id: 'r1' } });
      w.event({ type: 'output_audio_buffer.started', response_id: 'r1' });
      w.event({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    });
    await expect.poll(() => page.evaluate(() => (window as any).states.at(-1))).toBe('speaking');
    await page.evaluate(() => {
      const w = window as any;
      w.event({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
      w.event({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u1',
        delta: 'Smart Express',
      });
      w.event({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'older',
        transcript: 'stale input',
      });
      w.event({
        type: 'response.output_audio_transcript.delta',
        response_id: 'r1',
        delta: 'stale words',
      });
      w.event({ type: 'output_audio_buffer.started', response_id: 'r1' });
    });
    expect(await page.evaluate(() => (window as any).states.at(-1))).toBe('hearing');
    expect(
      await page.evaluate(() =>
        (window as any).transcripts.some((x: any) => x.text === 'stale words'),
      ),
    ).toBe(false);
    expect(await page.evaluate(() => (window as any).transcripts.at(-1).text)).toBe(
      'Smart Express',
    );
    expect(
      await page.evaluate(() =>
        (window as any).transcripts.some((x: any) => x.text === 'stale input'),
      ),
    ).toBe(false);
    expect(await page.evaluate(() => (window as any).sent.map((x: any) => x.type))).toContain(
      'output_audio_buffer.clear',
    );
    await page.evaluate(() => (window as any).live.setMuted(true));
    expect(await page.evaluate(() => (window as any).track.enabled)).toBe(false);
    await page.evaluate(() => (window as any).live.setMuted(false));
    expect(await page.evaluate(() => (window as any).track.enabled)).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      w.peer.connectionState = 'disconnected';
      w.peer.onconnectionstatechange();
      w.event({ type: 'response.created', response: { id: 'r2' } });
    });
    expect(await page.evaluate(() => (window as any).states.at(-1))).toBe('reconnecting');
    await page.evaluate(() => {
      const w = window as any;
      w.peer.connectionState = 'connected';
      w.peer.onconnectionstatechange();
      w.live.interrupt();
    });
    expect(await page.evaluate(() => (window as any).states.at(-1))).toBe('interrupted');
    await page.evaluate(async () => {
      await (window as any).live.close('test end');
    });
    expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(1);
    expect(await page.evaluate(() => (window as any).ended)).toBe('test end');
  });
