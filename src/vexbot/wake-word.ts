// Browser-local recognition only. Never fall back to a cloud SpeechRecognition
// service for an idle wake listener. Users explicitly arm it on each visit.
export const WAKE_PHRASE = 'Hey Vexbot';
type ResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type Recognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionConstructor = {
  new (): Recognition;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
};
const provider = () =>
  (window as unknown as { SpeechRecognition?: RecognitionConstructor }).SpeechRecognition;
export const matchesWakePhrase = (text: string) =>
  /(?:^|\s)hey vex\s?bot(?:$|\s)/.test(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
export async function localWakeAvailable() {
  const Constructor = provider();
  if (!window.isSecureContext || !Constructor?.available) return false;
  try {
    return (
      (await Constructor.available({ langs: ['en-US'], processLocally: true })) === 'available'
    );
  } catch {
    return false;
  }
}
export class WakeWordListener {
  private recognition: Recognition | null = null;
  private cancelled = false;
  private activated: () => void;
  private ended: (message: string) => void;
  constructor(activated: () => void, ended: (message: string) => void) {
    this.activated = activated;
    this.ended = ended;
  }
  async start() {
    if (!(await localWakeAvailable()) || this.cancelled)
      throw new Error('On-device wake detection is unavailable. Tap Talk to Vexbot to start.');
    const Constructor = provider()!;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.processLocally = true;
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      if (this.cancelled) return;
      for (let i = event.resultIndex; i < event.results.length; i++)
        if (event.results[i].isFinal && matchesWakePhrase(event.results[i][0].transcript)) {
          this.stop();
          this.activated();
          return;
        }
    };
    recognition.onerror = () => {
      this.stop();
      this.ended('Wake listening stopped. Check microphone permission or tap Talk to Vexbot.');
    };
    recognition.onend = () => {
      this.stop();
      this.ended('Wake listening ended. Tap to arm it again.');
    };
    recognition.start();
  }
  stop() {
    this.cancelled = true;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort();
    }
  }
}
