// The portal's Vexbot. The robot, its stage loop, director, flight, reduced motion, "Keep still" and "Hide
// robot" are the public website's companion (src/components/companion/companion.tsx), ported with the
// portal's sidebar perch. The panel is the portal's own: workspace-scoped, grounded chat with history,
// citations, private attachments and turn-based voice, all served by this portal's /api/vexbot.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, BookOpen, History, Loader2, MessageCircle, MessageSquare, Mic, Paperclip, Plus, Square, Volume2, X } from 'lucide-react';
import type { BotStage } from './bot-stage.ts';
import { CompanionDirector } from './companion/director.ts';
import { scanProtected, type Rect, type Scan } from './companion/safe-layout.ts';
import { choosePortalDock, MIN_BAR_VIEWPORT, perchStrip, stationTarget, type PortalDock, type PortalPage } from './companion/stations.ts';
import { blobToBase64, TurnRecorder, VOICE_PROBLEMS, voiceBlocked, type VoiceProblem } from './voice.ts';
import { UPLOAD_ACCEPT, UPLOAD_HINT, UPLOAD_STATUS, uploadPrivate, type UploadState } from './uploads.ts';
import { api } from '../services/portal';
import type { Client, Profile } from '../types/portal';
import './vexbot.css';

// The canvas is one fixed size, then scaled with a transform, so walking never re-allocates WebGL buffers.
const CANVAS_HEIGHT = 486;
const VIEW_HEIGHT_METRES = 2.2;
const FLOOR_METRES = 0.12;
const CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * 0.82);
const PIXELS_PER_METRE = CANVAS_HEIGHT / VIEW_HEIGHT_METRES;
const FLOOR_OFFSET = FLOOR_METRES * PIXELS_PER_METRE;
const STAGE_START_DELAY_MS = 1500;
const BAR_HEIGHT = 72;
const PERCH_LAUNCHER = 56;
const SIDE_PANEL_MIN_WIDTH = 1100;
const SIDE_PANEL_WIDTH = 400;
const PREFERENCES_KEY = 'vexora-portal-vexbot';

type Citation = { document_id: string; title: string; excerpt: string };
type VexMessage = { id: string; role: 'user' | 'assistant'; content: string; outcome?: 'answered' | 'no_answer' | 'unavailable'; withdrawn?: boolean; citations?: Citation[]; uses_profile?: boolean; attachments?: string[]; pending?: boolean };
type Summary = { id: string; title: string; workspace_id: string | null; updated_at: string };
type Status = 'idle' | 'thinking' | 'speaking';
type Voice = 'idle' | 'connecting' | 'recording' | 'paused' | 'transcribing';
type Preferences = { hidden: boolean; still: boolean; speak: boolean };

function readPreferences(): Preferences {
  const defaults = { hidden: false, still: false, speak: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') }; } catch { return defaults; }
}
const sameDock = (a: PortalDock, b: PortalDock) => a.kind === b.kind && (a.kind === 'bar' || (b.kind === 'perch' && ['left', 'right', 'top', 'bottom'].every((k) => Math.abs(a.rect[k as keyof Rect] - b.rect[k as keyof Rect]) < 1)));

export function Vexbot({ profile, workspaces, access, workspaceId, page, onMessages }: {
  profile: Profile;
  workspaces: Client[];
  /** The current user's access per workspace id. */
  access: Record<string, 'read' | 'write'>;
  /** The workspace the person is looking at, if any. Vexbot opens there. */
  workspaceId: string | null;
  page: PortalPage;
  onMessages: (workspace: string | null) => void;
}) {
  const admin = profile.role === 'admin';
  const canvas = useRef<HTMLCanvasElement>(null);
  const body = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const director = useRef<CompanionDirector | null>(null);
  const recorder = useRef<TurnRecorder | null>(null);
  const operation = useRef(0);
  const sending = useRef(false);
  const followBottom = useRef(true);
  const audioUrl = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scan = useRef<Scan | null>(null);
  const layoutInput = useRef({ open: false, page, dock: { kind: 'bar' } as PortalDock, conversation: false });

  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [stageReady, setStageReady] = useState(false);
  const [dock, setDock] = useState<PortalDock>({ kind: 'bar' });
  const [sidePanel, setSidePanel] = useState(false);
  const [canShowRobot, setCanShowRobot] = useState(true);
  const [service, setService] = useState<{ provider: string | null; voice: boolean; realtime?: { available: boolean; reason: string } } | null>(null);
  const [workspace, setWorkspace] = useState<string | null | undefined>(undefined);
  const [conversations, setConversations] = useState<Summary[]>([]);
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<VexMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [attachments, setAttachments] = useState<UploadState[]>([]);
  const [uploading, setUploading] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [voice, setVoice] = useState<Voice>('idle');
  const [notice, setNotice] = useState('');

  const hidden = preferences.hidden, still = preferences.still;
  const inConversation = voice !== 'idle';
  const options = workspaces.filter((row) => admin || access[row.id]);
  const chosen = workspace === undefined ? undefined : workspace;
  const writable = chosen === null ? admin : chosen ? access[chosen] === 'write' || admin : false;
  const needsWorkspace = chosen === undefined;

  useEffect(() => { layoutInput.current = { open, page, dock, conversation: inConversation }; }, [open, page, dock, inConversation]);

  useEffect(() => {
    let cancelled = false;
    api('vexbot', { action: 'status' }).then((value) => { if (!cancelled) setService(value); }).catch(() => { if (!cancelled) setService({ provider: null, voice: false }); });
    return () => { cancelled = true; };
  }, []);

  // Space for the controls is taken from the page, not painted over it, exactly as on the website.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const panel = panelRef.current;
      if (layoutInput.current.open && panel) {
        const side = innerWidth >= SIDE_PANEL_MIN_WIDTH;
        root.dataset.vexbotReserve = side ? 'side' : 'sheet';
        root.style.setProperty('--vexbot-reserve', `${side ? SIDE_PANEL_WIDTH : panel.getBoundingClientRect().height}px`);
      } else if (dock.kind === 'bar') {
        root.dataset.vexbotReserve = 'bar';
        root.style.setProperty('--vexbot-reserve', `${BAR_HEIGHT}px`);
      } else {
        delete root.dataset.vexbotReserve;
        root.style.removeProperty('--vexbot-reserve');
      }
    };
    apply();
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(apply);
    });
    if (panelRef.current) observer.observe(panelRef.current);
    return () => { cancelAnimationFrame(resizeFrame); observer.disconnect(); delete root.dataset.vexbotReserve; root.style.removeProperty('--vexbot-reserve'); };
  }, [dock, open]);

  // An on-screen keyboard shrinks the visual viewport without moving fixed elements on some phones.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => document.documentElement.style.setProperty('--vexbot-keyboard', `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`);
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => { viewport.removeEventListener('resize', apply); viewport.removeEventListener('scroll', apply); document.documentElement.style.removeProperty('--vexbot-keyboard'); };
  }, []);

  // Finds the page's content and the sidebar perch again whenever either could have moved.
  useEffect(() => {
    const root = wrapper.current;
    if (!root) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      scan.current = scanProtected(root);
      const perch = document.querySelector('[data-vexbot-perch]')?.getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      const rect = perch && sidebar && perch.height > 0 && perch.width > 0 ? { left: sidebar.left, right: sidebar.right, top: perch.top, bottom: perch.bottom - PERCH_LAUNCHER } : null;
      const chosenDock = choosePortalDock(rect, innerHeight);
      setSidePanel(innerWidth >= SIDE_PANEL_MIN_WIDTH);
      setCanShowRobot(chosenDock.kind !== 'bar' || innerHeight >= MIN_BAR_VIEWPORT);
      setDock((current) => (sameDock(current, chosenDock) ? current : chosenDock));
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(measure); };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    window.addEventListener('resize', schedule);
    document.addEventListener('toggle', schedule, true);
    return () => { cancelAnimationFrame(pending); observer.disconnect(); window.removeEventListener('resize', schedule); document.removeEventListener('toggle', schedule, true); };
  }, [page, open, workspaceId]);

  // The WebGL stage. Hiding the robot means nothing 3D is loaded or drawn.
  useEffect(() => {
    if (hidden) return;
    let cancelled = false, frame = 0, last = 0, sinceDraw = 0, stage: BotStage | null = null;
    const element = canvas.current!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = async () => {
      if (cancelled) return;
      try {
        const { createBotStage } = await import('./bot-stage.ts');
        const created = await createBotStage(element);
        if (cancelled) { created.dispose(); return; }
        stage = created;
        created.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
        created.animator.onTurnComplete = (yaw) => { created.yaw += yaw; };
        const movement = new CompanionDirector(created, PIXELS_PER_METRE);
        movement.frozen = reduced.matches;
        director.current = movement;
        setStageReady(true);
        let shownKey: string | null = null;
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop);
          const delta = Math.min((now - last) / 1000 || 0, 0.05);
          last = now;
          if (document.hidden) return;
          const { open: isOpen, page: currentPage, dock: currentDock, conversation } = layoutInput.current;
          const stageBox = isOpen ? stageRef.current?.getBoundingClientRect() ?? null : null;
          const controls = currentDock.kind === 'bar' ? dockRef.current?.getBoundingClientRect() ?? null : null;
          const placement = stationTarget({ viewportWidth: innerWidth, viewportHeight: innerHeight, canvasPixelsPerMetre: PIXELS_PER_METRE, scan: scan.current, scrollY, dock: currentDock, panelStage: stageBox, conversation, page: currentPage });
          const { target, shown } = placement;
          if (target.key !== shownKey) {
            if (shownKey !== null && (target.instant || movement.place === 'panel') && !reduced.matches) {
              element.style.transition = 'none';
              element.style.opacity = '0';
              requestAnimationFrame(() => { element.style.transition = ''; element.style.opacity = ''; });
            }
            shownKey = target.key;
          }
          movement.setTarget(target);
          movement.setAirspace({ viewportWidth: innerWidth, viewportHeight: innerHeight, scrollY, scan: scan.current, controls, allowed: shown && !isOpen && !conversation, strip: perchStrip(currentDock) });
          movement.update(delta);
          element.style.transform = `translate3d(${movement.x - CANVAS_WIDTH / 2}px, ${movement.y - CANVAS_HEIGHT + FLOOR_OFFSET}px, 0) scale(${movement.scale})`;
          element.style.visibility = shown ? 'visible' : 'hidden';
          if (body.current) {
            const size = 1.8 * PIXELS_PER_METRE * movement.scale;
            body.current.style.transform = `translate3d(${movement.x - size * 0.22}px, ${movement.y - size}px, 0)`;
            body.current.style.width = `${size * 0.44}px`;
            body.current.style.height = `${size}px`;
            body.current.style.visibility = shown ? 'visible' : 'hidden';
            // In the air it passes over the page, so it must never catch a click meant for what's underneath.
            body.current.style.pointerEvents = movement.flightPhase === 'grounded' ? '' : 'none';
          }
          const root = wrapper.current;
          if (root) {
            root.dataset.place = movement.place ?? '';
            root.dataset.state = movement.state;
            root.dataset.flight = movement.flightPhase;
            root.dataset.base = created.animator.base;
            root.dataset.gesture = created.animator.gesture ?? '';
            root.dataset.robot = shown ? 'shown' : 'collapsed';
            root.dataset.x = String(Math.round(movement.x));
            root.dataset.y = String(Math.round(movement.y));
            root.dataset.ppm = String(movement.scale * PIXELS_PER_METRE);
          }
          if (!shown) return;
          // Holding still needs no more than a calm 30 frames a second; walking and flying get every frame.
          sinceDraw += delta;
          if (movement.state === 'resting' && sinceDraw < (movement.frozen ? 0.5 : 1 / 30)) return;
          created.frame(movement.frozen ? 0 : sinceDraw);
          sinceDraw = 0;
        };
        frame = requestAnimationFrame(loop);
      } catch {
        // WebGL unavailable: the text launcher and the whole assistant still work without the character.
        if (wrapper.current) wrapper.current.dataset.webgl = 'unavailable';
      }
    };
    // Building the 3D scene blocks the main thread, so it waits until the page has painted.
    const delay = window.setTimeout(() => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void start(), { timeout: 2500 }); else void start(); }, STAGE_START_DELAY_MS);
    const onMotion = () => { if (director.current) director.current.frozen = reduced.matches; };
    reduced.addEventListener('change', onMotion);
    return () => {
      cancelled = true;
      clearTimeout(delay);
      reduced.removeEventListener('change', onMotion);
      cancelAnimationFrame(frame);
      stage?.dispose();
      director.current = null;
      setStageReady(false);
    };
  }, [hidden]);

  useEffect(() => { if (director.current) director.current.still = still; }, [still, stageReady]);

  // Speaking arms need more room than the bar has, so there the character keeps its calmer pose.
  useEffect(() => {
    const roomy = open || dock.kind === 'perch';
    const gesture = voice === 'recording' ? 'Listen' : voice === 'transcribing' || status === 'thinking' ? 'Think' : status === 'speaking' ? (roomy ? 'Speak' : 'Listen') : null;
    director.current?.setAttention(gesture);
  }, [status, voice, open, dock, stageReady]);

  useEffect(() => { if (followBottom.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, status]);
  function stopAudio() {
    audio.current?.pause();
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.removeAttribute('src'); audio.current.load(); }
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }
  function cancelInteraction() {
    operation.current++;
    sending.current = false;
    recorder.current?.cancel(); recorder.current = null;
    stopAudio();
    setVoice('idle'); setStatus('idle');
    setMessages(list => list.filter(message => !message.pending));
  }
  useEffect(() => () => { operation.current++; recorder.current?.cancel(); stopAudio(); }, []);
  useEffect(() => {
    const stop = () => { if (document.hidden) { cancelInteraction(); } };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);

  function updatePreferences(change: Partial<Preferences>) {
    const next = { ...preferences, ...change };
    setPreferences(next);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* Preferences just won't persist. */ }
  }

  const loadHistory = useCallback(async (target: string | null) => {
    const epoch = operation.current;
    try {
      const result = await api('vexbot', { action: 'conversations', workspace_id: target });
      if (epoch === operation.current) setConversations(result.conversations);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, []);

  function chooseWorkspace(target: string | null) {
    cancelInteraction();
    followBottom.current = true;
    setWorkspace(target);
    setConversation(null);
    setMessages([]);
    setAttachments([]);
    setHistoryOpen(false);
    void loadHistory(target);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openPanel() {
    setNotice('');
    setOpen(true);
    // Opens in the workspace being viewed; otherwise the only one; otherwise asks.
    const initial = workspaceId && (admin || access[workspaceId]) ? workspaceId : !admin && options.length === 1 ? options[0].id : undefined;
    if (workspace === undefined || (initial !== undefined && initial !== workspace && messages.length === 0)) {
      if (initial !== undefined) chooseWorkspace(initial);
      else setWorkspace(undefined);
    } else void loadHistory(workspace);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closePanel() {
    cancelInteraction();
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  function activate() {
    if (open) closePanel();
    else openPanel();
  }

  async function openConversation(id: string) {
    cancelInteraction();
    const epoch = operation.current;
    followBottom.current = true;
    setHistoryOpen(false);
    setNotice('');
    try {
      const result = await api('vexbot', { action: 'conversation', conversation_id: id });
      if (epoch !== operation.current) return;
      setConversation(id);
      setMessages(result.messages);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function newChat() {
    cancelInteraction();
    followBottom.current = true;
    setConversation(null);
    setMessages([]);
    setAttachments([]);
    setHistoryOpen(false);
    setNotice('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function speak(message: VexMessage) {
    if (!service?.voice) return;
    const epoch = operation.current;
    stopAudio();
    try {
      const result = await api('vexbot', { action: 'speech', message_id: message.id });
      if (epoch !== operation.current) return;
      stopAudio();
      // A blob: URL, which the portal's Content-Security-Policy allows for media (data: is not).
      const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
      const source = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      audioUrl.current = source;
      const player = new Audio(source);
      audio.current = player;
      setStatus('speaking');
      const finish = () => { if (audio.current === player) { setStatus('idle'); stopAudio(); } };
      player.onended = finish;
      player.onerror = finish;
      await player.play();
    } catch (error) {
      if (epoch !== operation.current) return;
      stopAudio();
      setStatus('idle');
      setNotice((error as Error).message);
    }
  }

  async function send(text: string, spoken = false) {
    if (chosen === undefined || sending.current) return;
    sending.current = true;
    const epoch = operation.current;
    stopAudio();
    followBottom.current = true;
    setNotice('');
    const ready = attachments.filter((row) => row.status !== 'awaiting_upload');
    const temp: VexMessage = { id: `pending-${Date.now()}`, role: 'user', content: text, pending: true, attachments: ready.map((row) => row.id) };
    setMessages((list) => [...list, temp]);
    setStatus('thinking');
    try {
      const result = await api('vexbot', { action: 'ask', workspace_id: chosen, conversation_id: conversation, question: text, attachments: ready.map((row) => row.id) });
      if (epoch !== operation.current) return;
      setConversation(result.conversation.id);
      setMessages((list) => [...list.filter((m) => m.id !== temp.id), ...result.messages]);
      setAttachments([]);
      void loadHistory(chosen);
      const reply = result.messages[1] as VexMessage;
      if ((spoken || preferences.speak) && service?.voice) await speak(reply);
      else setStatus('idle');
    } catch (error) {
      if (epoch !== operation.current) return;
      setMessages((list) => list.filter((m) => m.id !== temp.id));
      setQuestion(text);
      setNotice((error as Error).message);
      setStatus('idle');
    } finally { if (epoch === operation.current) sending.current = false; }
  }

  function ask(text: string, spoken = false) {
    const clean = text.trim();
    if (!clean || status === 'thinking' || uploading) return;
    setQuestion('');
    void send(clean, spoken);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    ask(question);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(question);
    }
  }

  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 5 - attachments.length);
    event.target.value = '';
    if (!chosen || !files.length) return;
    setNotice('');
    for (const file of files) {
      setUploading((n) => n + 1);
      const placeholder: UploadState = { id: `local-${file.name}-${Date.now()}`, name: file.name, status: 'awaiting_upload', status_detail: null };
      setAttachments((list) => [...list, placeholder]);
      try {
        const done = await uploadPrivate(file, 'attachment', chosen);
        setAttachments((list) => list.map((row) => (row.id === placeholder.id ? done : row)));
      } catch (error) {
        setAttachments((list) => list.filter((row) => row.id !== placeholder.id));
        setNotice((error as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function toggleVoice() {
    if (voice === 'transcribing' || voice === 'connecting') return;
    if (voice === 'recording' || voice === 'paused') {
      const turn = recorder.current;
      if (!turn) return;
      setVoice('transcribing');
      const epoch = operation.current;
      const clip = await turn.stop();
      if (epoch !== operation.current) return;
      recorder.current = null;
      try {
        if (!clip.size) throw new Error("I didn't hear anything. You can try again or type.");
        const { text } = await api('vexbot', { action: 'transcribe', workspace_id: chosen, mime: clip.type || turn.mime, audio: await blobToBase64(clip) });
        if (epoch !== operation.current) return;
        setVoice('idle');
        if (!text) { setNotice("I didn't catch that. You can try again or type."); return; }
        ask(text, true);
      } catch (error) {
        if (epoch !== operation.current) return;
        setVoice('idle');
        setNotice((error as Error).message);
      }
      return;
    }
    const blocked = voiceBlocked();
    if (blocked) { setNotice(VOICE_PROBLEMS[blocked]); return; }
    const turn = new TurnRecorder();
    const epoch = operation.current;
    recorder.current = turn;
    setVoice('connecting');
    try {
      await turn.start(() => void toggleVoiceRef.current());
      if (epoch !== operation.current) { turn.cancel(); return; }
      stopAudio();
      setNotice('');
      setVoice('recording');
    } catch (problem) {
      if (epoch !== operation.current) return;
      setVoice('idle');
      setNotice(VOICE_PROBLEMS[(problem as VoiceProblem)] ?? VOICE_PROBLEMS.failed);
    }
  }
  const toggleVoiceRef = useRef(toggleVoice);
  toggleVoiceRef.current = toggleVoice;

  const busy = status === 'thinking';
  const workspaceName = chosen === null ? 'Vexora knowledge' : options.find((row) => row.id === chosen)?.company;
  const statusText = voice === 'connecting' ? 'Waiting for microphone permission.' : voice === 'paused' ? 'Microphone muted. Resume or stop to send.' : voice === 'recording' ? 'Listening. Select stop when you have finished your question.' : voice === 'transcribing' ? 'Transcribing your question.' : busy ? 'Thinking.' : status === 'speaking' ? 'Answering.' : uploading ? 'Uploading attachment.' : '';
  const voiceOn = Boolean(service?.voice);

  return (
    <div ref={wrapper} className="vexbot" data-testid="vexbot" data-status={voice !== 'idle' ? voice : status} data-dock={dock.kind} data-robot={canShowRobot ? 'shown' : 'collapsed'} data-open={open ? '' : undefined}>
      {!hidden && <canvas ref={canvas} className="vexbot-canvas" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} aria-hidden="true" data-testid="vexbot-canvas" />}
      {/* Pointer shortcut only. Keyboard and screen reader users have the labelled launcher. */}
      {!hidden && stageReady && <button ref={body} type="button" className="vexbot-body" tabIndex={-1} aria-hidden="true" onClick={activate} data-testid="vexbot-body" />}

      {!open && (
        <div ref={dockRef} className="vexbot-dock" role="group" aria-label="Vexbot assistant" data-testid="vexbot-dock"
          style={dock.kind === 'perch' ? { left: dock.rect.left + 16, width: dock.rect.right - dock.rect.left - 32, top: dock.rect.bottom + 6 } : undefined}>
          {notice && dock.kind === 'bar' && <p className="vexbot-dock-status" role="status">{notice}</p>}
          <button ref={launcherRef} type="button" className="vexbot-launcher" onClick={openPanel} aria-haspopup="dialog" aria-expanded={open} data-testid="vexbot-launcher">
            <MessageCircle size={17} aria-hidden="true" />
            <span>Ask Vexbot</span>
          </button>
        </div>
      )}

      {open && (
        <section ref={panelRef} className={sidePanel ? 'vexbot-panel side' : 'vexbot-panel sheet'} role="dialog" aria-label="Vexbot assistant" data-testid="vexbot-panel" onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }}>
          <header className="vexbot-header">
            {/* The character's own space. It stands here while the panel is open, never over the page. */}
            <div ref={stageRef} className={hidden || !canShowRobot ? 'vexbot-stage empty' : 'vexbot-stage'} aria-hidden="true" data-testid="vexbot-stage" />
            <div className="vexbot-title">
              <h2>Vexbot</h2>
              {!needsWorkspace && (
                <label className="vexbot-workspace">
                  <span className="sr-only">Workspace</span>
                  <select value={chosen ?? ''} onChange={(event) => chooseWorkspace(event.target.value || null)} data-testid="vexbot-workspace">
                    {admin && <option value="">Vexora knowledge only</option>}
                    {options.map((row) => <option key={row.id} value={row.id}>{row.company}{access[row.id] === 'read' ? ' (read-only)' : ''}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!needsWorkspace && <button type="button" className="vexbot-icon" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} aria-label="Conversation history" title="History" data-testid="vexbot-history"><History size={18} aria-hidden="true" /></button>}
            {!needsWorkspace && <button type="button" className="vexbot-icon" onClick={newChat} aria-label="New conversation" title="New conversation" data-testid="vexbot-new"><Plus size={18} aria-hidden="true" /></button>}
            <button type="button" className="vexbot-icon" onClick={closePanel} aria-label="Close Vexbot"><X size={18} aria-hidden="true" /></button>
          </header>

          {historyOpen && (
            <nav className="vexbot-history" aria-label="Previous conversations" data-testid="vexbot-history-list">
              {conversations.length === 0 ? <p>No previous conversations in {workspaceName}.</p> : conversations.map((row) => (
                <button key={row.id} type="button" className={row.id === conversation ? 'active' : ''} onClick={() => void openConversation(row.id)}>
                  <span>{row.title}</span>
                  <small>{new Date(row.updated_at).toLocaleDateString()}</small>
                </button>
              ))}
            </nav>
          )}

          {needsWorkspace ? (
            <div className="vexbot-log" data-testid="vexbot-choose">
              <div className="vexbot-starters">
                <p>Choose the workspace you're asking about. Vexbot only uses information approved for it.</p>
                <ul>
                  {admin && <li><button type="button" onClick={() => chooseWorkspace(null)}>Vexora knowledge only</button></li>}
                  {options.map((row) => <li key={row.id}><button type="button" onClick={() => chooseWorkspace(row.id)}>{row.company}{access[row.id] === 'read' ? ' · read-only' : ''}</button></li>)}
                </ul>
                {options.length === 0 && !admin && <p>You don't have a workspace yet. Contact Vexora for access.</p>}
              </div>
            </div>
          ) : (
            <div ref={logRef} onScroll={() => { const log = logRef.current; if (log) followBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64; }} className="vexbot-log" role="log" aria-live="polite" aria-label="Conversation" tabIndex={0} data-testid="vexbot-log">
              {messages.length === 0 && (
                <div className="vexbot-starters">
                  <p>Ask about {workspaceName}. Answers come only from Vexora's approved information and published documents, with sources.</p>
                  <ul>
                    {['What are your support hours?', 'What happens next in my project?', 'How do I share a file with the team?'].map((starter) => (
                      <li key={starter}><button type="button" onClick={() => ask(starter)} disabled={busy}>{starter}</button></li>
                    ))}
                  </ul>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`vexbot-message ${message.role}${message.withdrawn ? ' withdrawn' : ''}`} data-testid={`vexbot-${message.role}`} data-outcome={message.outcome}>
                  <span className="sr-only">{message.role === 'user' ? 'You asked: ' : 'Vexbot: '}</span>
                  <p>{message.content}</p>
                  {message.citations && message.citations.length > 0 && (
                    <div className="vexbot-sources" data-testid="vexbot-sources">
                      <span><BookOpen size={13} aria-hidden="true" /> Sources</span>
                      <ol>
                        {message.citations.map((citation) => (
                          <li key={citation.document_id}>
                            <details>
                              <summary>{citation.title}</summary>
                              <blockquote>{citation.excerpt}</blockquote>
                            </details>
                          </li>
                        ))}
                        {message.uses_profile && <li>Vexora business profile</li>}
                      </ol>
                    </div>
                  )}
                  {message.role === 'assistant' && !message.citations?.length && message.uses_profile && <div className="vexbot-sources"><span><BookOpen size={13} aria-hidden="true" /> Source: Vexora business profile</span></div>}
                  {message.role === 'assistant' && message.outcome !== 'answered' && !message.withdrawn && (
                    <button type="button" className="vexbot-contact" onClick={() => { closePanel(); onMessages(chosen ?? null); }} data-testid="vexbot-contact">
                      <MessageSquare size={14} aria-hidden="true" /> Message the team
                    </button>
                  )}
                  {message.role === 'assistant' && voiceOn && !message.withdrawn && (
                    <button type="button" className="vexbot-play" onClick={() => void speak(message)} aria-label="Play this reply aloud" title="Play aloud"><Volume2 size={14} aria-hidden="true" /></button>
                  )}
                </div>
              ))}
              {busy && <div className="vexbot-message assistant thinking" aria-hidden="true"><Loader2 size={16} className="spin" /> Thinking…</div>}
            </div>
          )}

          <p className="vexbot-status" role="status" data-testid="vexbot-status">{notice || statusText}</p>

          {!needsWorkspace && (
            <form className="vexbot-composer" onSubmit={onSubmit}>
              {attachments.length > 0 && (
                <ul className="vexbot-attachments" aria-label="Attachments" data-testid="vexbot-attachments">
                  {attachments.map((row) => (
                    <li key={row.id} data-status={row.status}>
                      <Paperclip size={13} aria-hidden="true" />
                      <span>{row.name}</span>
                      <small>{UPLOAD_STATUS[row.status]}</small>
                      <button type="button" className="vexbot-icon small" aria-label={`Remove ${row.name}`} onClick={() => setAttachments((list) => list.filter((item) => item.id !== row.id))}><X size={13} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="vexbot-input">
                <label className="sr-only" htmlFor="vexbot-question">Message Vexbot</label>
                <textarea ref={inputRef} id="vexbot-question" value={question} rows={1} maxLength={2000} placeholder={voice === 'recording' ? 'Listening…' : `Message Vexbot about ${workspaceName}`}
                  onChange={(event) => setQuestion(event.target.value)} onKeyDown={onComposerKey} disabled={voice !== 'idle'} enterKeyHint="send" data-testid="vexbot-input" />
                <div className="vexbot-actions">
                  {writable && chosen && (
                    <>
                      <input ref={fileRef} type="file" hidden multiple accept={UPLOAD_ACCEPT} onChange={attach} data-testid="vexbot-file" />
                      <button type="button" className="vexbot-icon" onClick={() => fileRef.current?.click()} disabled={attachments.length >= 5 || voice !== 'idle'} aria-label="Attach files" title={UPLOAD_HINT}><Paperclip size={18} aria-hidden="true" /></button>
                    </>
                  )}
                  {voiceOn && (
                    <button type="button" className={`vexbot-icon${voice === 'recording' ? ' recording' : ''}`} onClick={() => void toggleVoice()} aria-pressed={voice === 'recording'} disabled={voice === 'transcribing' || voice === 'connecting' || busy}
                      aria-label={voice === 'recording' || voice === 'paused' ? 'Stop recording and send' : 'Ask by voice'} title={voice === 'recording' ? 'Stop and send' : 'Ask by voice'} data-testid="vexbot-mic">
                      {voice === 'recording' || voice === 'paused' ? <Square size={16} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
                    </button>
                  )}
                  {(voice === 'recording' || voice === 'paused') && <>
                    <button type="button" className="vexbot-icon" aria-label={voice === 'paused' ? 'Resume microphone' : 'Mute microphone'} aria-pressed={voice === 'paused'} onClick={() => { const muted = voice !== 'paused'; recorder.current?.mute(muted); setVoice(muted ? 'paused' : 'recording'); }}><Mic size={18} aria-hidden="true" /></button>
                    <button type="button" className="vexbot-icon" aria-label="Cancel recording" onClick={cancelInteraction}><X size={18} aria-hidden="true" /></button>
                  </>}
                  {status === 'speaking' && <button type="button" className="vexbot-icon" aria-label="Stop spoken reply" onClick={() => { stopAudio(); setStatus('idle'); }}><Square size={16} aria-hidden="true" /></button>}
                  <button type="submit" className="vexbot-send" disabled={busy || !question.trim() || uploading > 0 || voice !== 'idle'} aria-label="Send message" data-testid="vexbot-send"><ArrowUp size={18} aria-hidden="true" /></button>
                </div>
              </div>
            </form>
          )}

          <div className="vexbot-controls" role="group" aria-label="Vexbot settings">
            <button type="button" aria-pressed={still} onClick={() => updatePreferences({ still: !still })} data-testid="vexbot-still">Keep still</button>
            <button type="button" aria-pressed={hidden} onClick={() => updatePreferences({ hidden: !hidden })} data-testid="vexbot-hide">Hide robot</button>
            {voiceOn && <button type="button" aria-pressed={preferences.speak} onClick={() => updatePreferences({ speak: !preferences.speak })} data-testid="vexbot-speak">Spoken replies</button>}
          </div>
          {service?.realtime && !service.realtime.available && <details className="vexbot-disclosure"><summary>Live voice availability</summary>{service.realtime.reason}</details>}
          <p className="vexbot-disclosure">
            AI assistant. It answers only from information Vexora has approved and cites its sources; the team confirms anything important.
            {voiceOn ? ' Voice is turn-based: record a question, then Vexbot replies. Recordings go to the AI provider to be transcribed and are not stored.' : ''}
            {service?.provider === 'mock' ? ' Local test mode: answers come from a mock provider.' : ''}
          </p>
        </section>
      )}
    </div>
  );
}
