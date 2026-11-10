import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { motionTokens } from '../design/motion-tokens';
import { completeVexbot } from '../services/activity';
// The portal's Vexbot. The robot, its stage loop, director, flight, reduced motion, "Keep still" and "Hide
// robot" are the public website's companion (src/components/companion/companion.tsx), ported with the
// portal's sidebar perch. The panel is the portal's own: workspace-scoped, grounded chat with history,
// citations, private attachments, supervised Realtime voice and a recorded-voice fallback.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowUp,
  BookOpen,
  Download,
  FileText,
  History,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type { BotStage } from './bot-stage.ts';
import { CompanionDirector } from './companion/director.ts';
import { scanProtected, type Rect, type Scan } from './companion/safe-layout.ts';
import {
  choosePortalDock,
  MIN_BAR_VIEWPORT,
  perchStrip,
  stationTarget,
  type PortalDock,
  type PortalPage,
} from './companion/stations.ts';
import {
  blobToBase64,
  playReply,
  primeAudio,
  TurnRecorder,
  VOICE_PROBLEMS,
  voiceBlocked,
  VoiceSession,
  type VoiceProblem,
} from './voice.ts';
import { RealtimeVoice, realtimeBlocked } from './realtime.ts';
import { localWakeAvailable, WakeWordListener, WAKE_PHRASE } from './wake-word.ts';
import { streamQuestion } from './chat-stream';
import {
  UPLOAD_ACCEPT,
  UPLOAD_HINT,
  UPLOAD_STATUS,
  uploadPrivate,
  type UploadState,
} from './uploads.ts';
import { api, db, unwrap } from '../services/portal';
import type { Client, Profile } from '../types/portal';
import './vexbot.css';
const DocumentPreview = lazy(() => import('../components/DocumentPreview'));

// The canvas is one fixed size, then scaled with a transform, so walking never re-allocates WebGL buffers.
const CANVAS_HEIGHT = 486;
const VIEW_HEIGHT_METRES = 2.2;
const FLOOR_METRES = 0.12;
const CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * 0.82);
const PIXELS_PER_METRE = CANVAS_HEIGHT / VIEW_HEIGHT_METRES;
const FLOOR_OFFSET = FLOOR_METRES * PIXELS_PER_METRE;
const STAGE_START_DELAY_MS = 1500;
const BAR_HEIGHT = 72;
// Room under the robot on the perch for the two stacked controls (Talk to Vexbot, Ask Vexbot).
const PERCH_LAUNCHER = 108;
const SIDE_PANEL_MIN_WIDTH = 1100;
const SIDE_PANEL_WIDTH = 400;
const PREFERENCES_KEY = 'vexora-portal-vexbot';

type Citation = {
  kind?: 'document' | 'file';
  id?: string;
  document_id?: string;
  file_id?: string;
  title: string;
  excerpt: string;
};
const citationKey = (citation: Citation) => citation.id ?? citation.document_id ?? citation.title;
type VexMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  outcome?: 'answered' | 'no_answer' | 'unavailable';
  withdrawn?: boolean;
  interrupted?: boolean;
  citations?: Citation[];
  uses_profile?: boolean;
  attachments?: string[];
  pending?: boolean;
};
type Summary = { id: string; title: string; workspace_id: string | null; updated_at: string };
type Status = 'idle' | 'thinking' | 'speaking';
type Voice = 'idle' | 'connecting' | 'recording' | 'paused' | 'transcribing';
/** Hands-free voice mode beside the robot, with the panel closed. */
type Talk =
  | 'off'
  | 'starting'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'reconnecting';
const TALK_TEXT: Record<Talk, string> = {
  off: '',
  starting: 'Starting…',
  listening: 'Listening. Ask your question.',
  hearing: 'Listening…',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  interrupted: 'Interrupted. Go ahead.',
  reconnecting: 'Connection interrupted. Reconnecting…',
};
export const ASK_EVENT = 'vexbot:prefill';
export const CONTEXT_EVENT = 'vexbot:context';
type PortalSelection = {
  workspace?: string;
  file_id?: string;
  message_id?: string;
  thread_id?: string;
};
type Preferences = { hidden: boolean; still: boolean; speak: boolean };

function readPreferences(): Preferences {
  const defaults = { hidden: false, still: false, speak: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}
const sameDock = (a: PortalDock, b: PortalDock) =>
  a.kind === b.kind &&
  (a.kind === 'bar' ||
    (b.kind === 'perch' &&
      ['left', 'right', 'top', 'bottom'].every(
        (k) => Math.abs(a.rect[k as keyof Rect] - b.rect[k as keyof Rect]) < 1,
      )));

export function Vexbot({
  profile,
  workspaces,
  access,
  workspaceId,
  page,
  onMessages,
}: {
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
  const textRequest = useRef<AbortController | null>(null);
  const [partial, setPartial] = useState('');
  const followBottom = useRef(true);
  const audioRequest = useRef(0);
  const audioUrl = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scan = useRef<Scan | null>(null);
  const layoutInput = useRef({
    open: false,
    page,
    dock: { kind: 'bar' } as PortalDock,
    conversation: false,
  });

  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [stageReady, setStageReady] = useState(false);
  const [dock, setDock] = useState<PortalDock>({ kind: 'bar' });
  const [sidePanel, setSidePanel] = useState(false);
  const [canShowRobot, setCanShowRobot] = useState(true);
  const [service, setService] = useState<{
    provider: string | null;
    voice: boolean;
    realtime?: { available: boolean; reason: string };
  } | null>(null);
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
  const reduced = useReducedMotion();
  const [talk, setTalk] = useState<Talk>('off');
  const [talkMuted, setTalkMuted] = useState(false);
  const [talkHeard, setTalkHeard] = useState('');
  const [talkReply, setTalkReply] = useState<VexMessage | null>(null);
  const [talkNotice, setTalkNotice] = useState('');
  const [revealSources, setRevealSources] = useState<string | null>(null);
  const session = useRef<VoiceSession | null>(null);
  const liveSession = useRef<RealtimeVoice | null>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const [sourcePreview, setSourcePreview] = useState<{ blob: Blob; name: string } | null>(null);
  useEffect(() => {
    if (sourcePreview) sourceDialog.current?.showModal();
  }, [sourcePreview]);
  const portalSelection = useRef<PortalSelection>({});
  const wake = useRef<WakeWordListener | null>(null);
  const [wakeSupported, setWakeSupported] = useState(false);
  const [wakeArmed, setWakeArmed] = useState(false);
  useEffect(() => {
    let active = true;
    void localWakeAvailable().then((value) => {
      if (active) setWakeSupported(value);
    });
    return () => {
      active = false;
      wake.current?.stop();
    };
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      portalSelection.current = (event as CustomEvent<PortalSelection>).detail ?? {};
    };
    window.addEventListener(CONTEXT_EVENT, listener);
    return () => window.removeEventListener(CONTEXT_EVENT, listener);
  }, []);
  const [liveVoice, setLiveVoice] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const playing = useRef<ReturnType<typeof playReply> | null>(null);
  // Bumped to stop a running voice loop; each loop only acts while its own number is current.
  const talkRun = useRef(0);
  const talkActive = useRef(false);
  const mutedRef = useRef(false);
  const greetingRequest = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);
  const talkRef = useRef<HTMLButtonElement>(null);

  const hidden = preferences.hidden,
    still = preferences.still;
  const inConversation = voice !== 'idle' || talk !== 'off';
  const options = workspaces.filter((row) => admin || access[row.id]);
  const chosen = workspace === undefined ? undefined : workspace;
  const writable = chosen === null ? admin : chosen ? access[chosen] === 'write' || admin : false;
  const needsWorkspace = chosen === undefined;

  useEffect(() => {
    layoutInput.current = { open, page, dock, conversation: inConversation };
  }, [open, page, dock, inConversation]);

  useEffect(() => {
    let cancelled = false;
    api('vexbot', { action: 'status' })
      .then((value) => {
        if (!cancelled) setService(value);
      })
      .catch(() => {
        if (!cancelled) setService({ provider: null, voice: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Space for the controls is taken from the page, not painted over it, exactly as on the website.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const panel = panelRef.current;
      if (layoutInput.current.open && panel) {
        const side = innerWidth >= SIDE_PANEL_MIN_WIDTH;
        root.dataset.vexbotReserve = side ? 'side' : 'sheet';
        root.style.setProperty(
          '--vexbot-reserve',
          `${side ? SIDE_PANEL_WIDTH : panel.getBoundingClientRect().height}px`,
        );
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
    return () => {
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      delete root.dataset.vexbotReserve;
      root.style.removeProperty('--vexbot-reserve');
    };
  }, [dock, open]);

  // An on-screen keyboard shrinks the visual viewport without moving fixed elements on some phones.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        '--vexbot-keyboard',
        `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--vexbot-keyboard');
    };
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
      const rect =
        perch && sidebar && perch.height > 0 && perch.width > 0
          ? {
              left: sidebar.left,
              right: sidebar.right,
              top: perch.top,
              bottom: perch.bottom - PERCH_LAUNCHER,
            }
          : null;
      const chosenDock = choosePortalDock(rect, innerHeight);
      setSidePanel(innerWidth >= SIDE_PANEL_MIN_WIDTH);
      setCanShowRobot(chosenDock.kind !== 'bar' || innerHeight >= MIN_BAR_VIEWPORT);
      setDock((current) => (sameDock(current, chosenDock) ? current : chosenDock));
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    window.addEventListener('resize', schedule);
    document.addEventListener('toggle', schedule, true);
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('toggle', schedule, true);
    };
  }, [page, open, workspaceId]);

  // The WebGL stage. Hiding the robot means nothing 3D is loaded or drawn.
  useEffect(() => {
    if (hidden) return;
    let cancelled = false,
      frame = 0,
      last = 0,
      sinceDraw = 0,
      stage: BotStage | null = null;
    const element = canvas.current!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = async () => {
      if (cancelled) return;
      try {
        const { createBotStage } = await import('./bot-stage.ts');
        const created = await createBotStage(element);
        if (cancelled) {
          created.dispose();
          return;
        }
        stage = created;
        created.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
        created.animator.onTurnComplete = (yaw) => {
          created.yaw += yaw;
        };
        const movement = new CompanionDirector(created, PIXELS_PER_METRE);
        movement.frozen = reduced.matches;
        director.current = movement;
        setStageReady(true);
        let shownKey: string | null = null;
        let previousDock: 'perch' | 'bar' | null = null;
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop);
          const delta = Math.min((now - last) / 1000 || 0, 0.05);
          last = now;
          if (document.hidden) return;
          const {
            open: isOpen,
            page: currentPage,
            dock: currentDock,
            conversation,
          } = layoutInput.current;
          const stageBox = isOpen ? (stageRef.current?.getBoundingClientRect() ?? null) : null;
          const controls =
            currentDock.kind === 'bar' ? (dockRef.current?.getBoundingClientRect() ?? null) : null;
          const placement = stationTarget({
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            canvasPixelsPerMetre: PIXELS_PER_METRE,
            scan: scan.current,
            scrollY,
            dock: currentDock,
            panelStage: stageBox,
            conversation,
            page: currentPage,
          });
          const { target, shown } = placement;
          if (target.key !== shownKey) {
            if (
              shownKey !== null &&
              (target.instant || movement.place === 'panel') &&
              !reduced.matches
            ) {
              element.style.transition = 'none';
              element.style.opacity = '0';
              requestAnimationFrame(() => {
                element.style.transition = '';
                element.style.opacity = '';
              });
            }
            shownKey = target.key;
          }
          // A resized sidebar can disappear entirely. Transfer directly between responsive docks,
          // rather than flying the previous desktop-sized character across the mobile video/content.
          const dockChanged = previousDock !== null && previousDock !== currentDock.kind;
          movement.setTarget(dockChanged ? { ...target, instant: true } : target);
          previousDock = currentDock.kind;
          movement.setAirspace({
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            scrollY,
            scan: scan.current,
            controls,
            allowed: shown && !isOpen && !conversation,
            strip: perchStrip(currentDock),
          });
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
    const delay = window.setTimeout(() => {
      if (typeof requestIdleCallback === 'function')
        requestIdleCallback(() => void start(), { timeout: 2500 });
      else void start();
    }, STAGE_START_DELAY_MS);
    const onMotion = () => {
      if (director.current) director.current.frozen = reduced.matches;
    };
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

  useEffect(() => {
    if (director.current) director.current.still = still;
  }, [still, stageReady]);

  // Speaking arms need more room than the bar has, so there the character keeps its calmer pose.
  useEffect(() => {
    const roomy = open || dock.kind === 'perch';
    const listening =
      voice === 'connecting' ||
      voice === 'recording' ||
      voice === 'paused' ||
      talk === 'listening' ||
      talk === 'hearing' ||
      talk === 'starting';
    const thinking =
      voice === 'transcribing' ||
      status === 'thinking' ||
      talk === 'transcribing' ||
      talk === 'thinking';
    const speaking = status === 'speaking' || talk === 'speaking';
    const waiting =
      liveVoice && (talk === 'listening' || talk === 'starting' || talk === 'reconnecting');
    const gesture =
      talkMuted || waiting
        ? null
        : listening
          ? 'Listen'
          : thinking
            ? 'Think'
            : speaking
              ? roomy
                ? 'Speak'
                : 'Listen'
              : null;
    director.current?.setAttention(gesture);
  }, [status, voice, talk, open, dock, stageReady, talkMuted, liveVoice]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  useEffect(() => {
    if (followBottom.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, status, partial]);
  function stopAudio() {
    audioRequest.current++;
    audio.current?.pause();
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.removeAttribute('src');
      audio.current.load();
    }
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }
  function cancelInteraction() {
    operation.current++;
    textRequest.current?.abort();
    setPartial('');
    sending.current = false;
    recorder.current?.cancel();
    recorder.current = null;
    stopAudio();
    setVoice('idle');
    setStatus('idle');
    setMessages((list) => list.filter((message) => !message.pending));
  }
  useEffect(
    () => () => {
      operation.current++;
      textRequest.current?.abort();
      recorder.current?.cancel();
      stopAudio();
      talkRun.current++;
      wake.current?.stop();
      greetingRequest.current?.abort();
      session.current?.close();
      void liveSession.current?.close();
      playing.current?.stop();
      player.current?.pause();
    },
    [],
  );
  useEffect(() => {
    const stop = () => {
      if (document.hidden) {
        cancelInteraction();
        endTalk();
      }
    };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);
  useEffect(() => {
    cancelInteraction();
    endTalk();
    sourceDialog.current?.close();
    setSourcePreview(null);
    portalSelection.current = {};
  }, [workspaceId]);
  useEffect(() => {
    const { data } = db().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') endTalk();
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (talkActive.current && workspace && !admin && !access[workspace])
      endTalk('Workspace access changed.');
  }, [access, workspace, admin]);

  // "Ask Vexbot about this file" from Shared files: opens text chat in that workspace with the question ready.
  const prefill = useRef<
    (detail: PortalSelection & { workspace: string; question: string }) => void
  >(() => {});
  useEffect(() => {
    const listener = (event: Event) => prefill.current((event as CustomEvent).detail);
    window.addEventListener(ASK_EVENT, listener);
    return () => window.removeEventListener(ASK_EVENT, listener);
  }, []);

  function updatePreferences(change: Partial<Preferences>) {
    const next = { ...preferences, ...change };
    setPreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      /* Preferences just won't persist. */
    }
  }

  const loadHistory = useCallback(async (target: string | null) => {
    const epoch = operation.current;
    try {
      const result = await api('vexbot', { action: 'conversations', workspace_id: target });
      if (epoch === operation.current) setConversations(result.conversations);
    } catch (error) {
      if (epoch === operation.current) setNotice((error as Error).message);
    }
  }, []);

  function chooseWorkspace(target: string | null) {
    completeVexbot(conversationRef.current);
    if (talkActive.current) endTalk();
    cancelInteraction();
    followBottom.current = true;
    setWorkspace(target);
    conversationRef.current = null;
    setConversation(null);
    setConversations([]);
    setMessages([]);
    setAttachments([]);
    setHistoryOpen(false);
    void loadHistory(target);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openPanel() {
    if (liveSession.current) {
      const ending = endTalk('Finishing the voice transcript…');
      void ending?.then(() => openPanel());
      return;
    }
    // Text chat takes over from voice mode; the conversation carries on in the panel.
    if (talkRun.current && talk !== 'off') endTalk();
    setTalkNotice('');
    setNotice('');
    setOpen(true);
    // Opens in the workspace being viewed; otherwise the only one; otherwise asks.
    const initial =
      workspaceId && (admin || access[workspaceId])
        ? workspaceId
        : !admin && options.length === 1
          ? options[0].id
          : undefined;
    if (
      workspace === undefined ||
      (initial !== undefined && initial !== workspace && messages.length === 0)
    ) {
      if (initial !== undefined) chooseWorkspace(initial);
      else setWorkspace(undefined);
    } else void loadHistory(workspace);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closePanel() {
    completeVexbot(conversationRef.current);
    endTalk();
    cancelInteraction();
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  function activate() {
    // While Vexbot is speaking in voice mode, touching the robot interrupts it, as a person would.
    if (talk === 'speaking') {
      if (liveSession.current) liveSession.current.interrupt();
      else playing.current?.stop();
      return;
    }
    if (talk !== 'off') return;
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
      conversationRef.current = id;
      setConversation(id);
      setMessages(result.messages);
    } catch (error) {
      if (epoch === operation.current) setNotice((error as Error).message);
    }
  }

  function newChat() {
    completeVexbot(conversationRef.current);
    cancelInteraction();
    followBottom.current = true;
    conversationRef.current = null;
    setConversation(null);
    setMessages([]);
    setAttachments([]);
    setHistoryOpen(false);
    setNotice('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function speak(message: VexMessage) {
    wake.current?.stop();
    wake.current = null;
    setWakeArmed(false);
    if (!service?.voice || message.outcome === 'unavailable') return;
    const epoch = operation.current;
    stopAudio();
    const request = audioRequest.current;
    try {
      const result = await api('vexbot', { action: 'speech', message_id: message.id });
      if (epoch !== operation.current || request !== audioRequest.current) return;
      // A blob: URL, which the portal's Content-Security-Policy allows for media (data: is not).
      const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
      const source = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      audioUrl.current = source;
      const player = new Audio(source);
      audio.current = player;
      setStatus('speaking');
      const finish = () => {
        if (audio.current === player) {
          setStatus('idle');
          stopAudio();
        }
      };
      player.onended = finish;
      player.onerror = finish;
      await player.play();
    } catch (error) {
      if (epoch !== operation.current || request !== audioRequest.current) return;
      stopAudio();
      setStatus('idle');
      setNotice((error as Error).message);
    }
  }

  async function send(text: string, spoken = false, userMessageId?: string) {
    if (chosen === undefined || sending.current) return;
    sending.current = true;
    const epoch = operation.current;
    stopAudio();
    followBottom.current = true;
    setNotice('');
    const ready = attachments.filter((row) => row.status !== 'awaiting_upload');
    const temp: VexMessage = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: text,
      pending: true,
      attachments: ready.map((row) => row.id),
    };
    setMessages((list) => [...list, temp]);
    setStatus('thinking');
    const controller = new AbortController();
    textRequest.current = controller;
    setPartial('');
    let incoming = '';
    let frame = 0;
    try {
      const result = await streamQuestion<{
        conversation: Summary;
        messages: VexMessage[];
        open_file?: string;
      }>(
        {
          action: 'ask',
          workspace_id: chosen,
          conversation_id: conversationRef.current,
          question: text,
          medium: spoken ? 'voice' : 'text',
          user_message_id: userMessageId,
          attachments: ready.map((row) => row.id),
          portal_context: {
            ...(portalSelection.current.workspace === chosen ? portalSelection.current : {}),
            page,
          },
        },
        controller.signal,
        (text) => {
          incoming += text;
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              if (epoch === operation.current) setPartial(incoming);
            });
        },
      );
      if (epoch !== operation.current) return;
      conversationRef.current = result.conversation.id;
      setConversation(result.conversation.id);
      setMessages((list) => [...list.filter((m) => m.id !== temp.id), ...result.messages]);
      setAttachments([]);
      if (result.open_file) void previewSource(result.open_file, chosen);
      void loadHistory(chosen);
      const reply = result.messages[1] as VexMessage;
      if (reply.outcome !== 'unavailable' && (spoken || preferences.speak) && service?.voice)
        await speak(reply);
      else setStatus('idle');
    } catch (error) {
      if (epoch !== operation.current) return;
      setMessages((list) => list.filter((m) => m.id !== temp.id));
      setQuestion(text);
      setNotice((error as Error).message);
      setStatus('idle');
    } finally {
      cancelAnimationFrame(frame);
      if (epoch === operation.current) {
        sending.current = false;
        setPartial('');
        textRequest.current = null;
      }
    }
  }

  function ask(text: string, spoken = false, userMessageId?: string) {
    const clean = text.trim();
    if (!clean || status === 'thinking' || uploading) return;
    setQuestion('');
    void send(clean, spoken, userMessageId);
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
      const placeholder: UploadState = {
        id: `local-${file.name}-${Date.now()}`,
        name: file.name,
        status: 'awaiting_upload',
        status_detail: null,
      };
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
    wake.current?.stop();
    wake.current = null;
    setWakeArmed(false);
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
        const { text, conversation_id, user_message_id } = await api('vexbot', {
          action: 'transcribe',
          workspace_id: chosen,
          conversation_id: conversationRef.current,
          persist: true,
          mime: clip.type || turn.mime,
          audio: await blobToBase64(clip),
        });
        if (epoch !== operation.current) return;
        setVoice('idle');
        if (!text) {
          setNotice("I didn't catch that. You can try again or type.");
          return;
        }
        if (conversation_id) {
          conversationRef.current = conversation_id;
          setConversation(conversation_id);
        }
        ask(text, true, user_message_id);
      } catch (error) {
        if (epoch !== operation.current) return;
        setVoice('idle');
        setNotice((error as Error).message);
      }
      return;
    }
    const blocked = voiceBlocked();
    if (blocked) {
      setNotice(VOICE_PROBLEMS[blocked]);
      return;
    }
    const turn = new TurnRecorder();
    const epoch = operation.current;
    recorder.current = turn;
    setVoice('connecting');
    try {
      await turn.start(() => void toggleVoiceRef.current());
      if (epoch !== operation.current) {
        turn.cancel();
        return;
      }
      stopAudio();
      setNotice('');
      setVoice('recording');
    } catch (problem) {
      if (epoch !== operation.current) return;
      recorder.current = null;
      setVoice('idle');
      setNotice(VOICE_PROBLEMS[problem as VoiceProblem] ?? VOICE_PROBLEMS.failed);
    }
  }
  const toggleVoiceRef = useRef(toggleVoice);
  toggleVoiceRef.current = toggleVoice;

  // ---- Voice mode: talk to the robot with the panel closed --------------------------------------------------
  /** The workspace voice mode talks about: the one on screen, else the current or only one. */
  function talkWorkspace(): string | null | undefined {
    if (workspaceId && (admin || access[workspaceId])) return workspaceId;
    if (workspace !== undefined) return workspace;
    if (!admin && options.length === 1) return options[0].id;
    return admin ? null : undefined;
  }

  function endTalk(message = '') {
    wake.current?.stop();
    wake.current = null;
    setWakeArmed(false);
    if (talkActive.current) completeVexbot(conversationRef.current);
    const ending = liveSession.current?.close();
    liveSession.current = null;
    talkRun.current++;
    talkActive.current = false;
    greetingRequest.current?.abort();
    greetingRequest.current = null;
    player.current?.pause();
    session.current?.close();
    session.current = null;
    playing.current?.stop();
    playing.current = null;
    setTalk('off');
    setTalkMuted(false);
    mutedRef.current = false;
    setTalkHeard('');
    setTalkReply(null);
    setTalkNotice(message);
    setPlaybackBlocked(false);
    return ending;
  }

  async function startTalk(recorded = false) {
    if (talkActive.current) return;
    wake.current?.stop();
    wake.current = null;
    setWakeArmed(false);
    setNotice('');
    setRevealSources(null);
    if (!service?.voice && !(service?.realtime?.available && !recorded)) {
      const missing = (service as { setup?: { missing?: string[] } } | null)?.setup?.missing ?? [];
      setTalkNotice(
        !service
          ? 'Checking whether voice is available…'
          : admin && missing.length
            ? `Voice isn't set up for this portal yet. The server needs: ${missing.join(', ')}.`
            : "Voice isn't available in this portal yet. You can ask Vexbot in text instead.",
      );
      return;
    }
    const target = talkWorkspace();
    if (target === undefined) {
      setTalkNotice('Open a workspace first, or choose one in text chat.');
      return;
    }
    if (service?.realtime?.available && !recorded) {
      setLiveVoice(true);
      const blocked = realtimeBlocked();
      if (blocked) {
        setTalkNotice(blocked);
        return;
      }
      cancelInteraction();
      if (target !== workspace) chooseWorkspace(target);
      setOpen(false);
      const epoch = operation.current;
      const run = ++talkRun.current;
      talkActive.current = true;
      setLiveVoice(true);
      setTalk('starting');
      setTalkNotice('');
      setTalkHeard('');
      setTalkReply(null);
      const live = new RealtimeVoice({
        workspace: target,
        conversation: conversationRef.current,
        context: {
          ...(portalSelection.current.workspace === target ? portalSelection.current : {}),
          page,
        },
        openFile(id) {
          if (run === talkRun.current) void previewSource(id, target);
        },
        async token() {
          const current = unwrap(await db().auth.getSession()).session;
          if (!current) throw new Error('Sign in to continue.');
          return current.access_token;
        },
        state(value) {
          if (run === talkRun.current) setTalk(value === 'connecting' ? 'starting' : value);
        },
        transcript(role, text) {
          if (run !== talkRun.current) return;
          if (role === 'user') {
            setTalkHeard(text);
            setTalkReply(null);
          } else
            setTalkReply(text ? { id: 'live-caption', role: 'assistant', content: text } : null);
        },
        snapshot(value) {
          if (epoch !== operation.current) return;
          conversationRef.current = value.conversation.id;
          setConversation(value.conversation.id);
          if (value.messages) {
            setMessages(value.messages);
            const reply = value.messages.at(-1) as VexMessage | undefined;
            if (reply?.role === 'assistant') setTalkReply(reply);
          }
        },
        ended(reason) {
          if (run !== talkRun.current) return;
          talkActive.current = false;
          setTalk('off');
          setTalkMuted(false);
          mutedRef.current = false;
          setTalkNotice(reason);
          setPlaybackBlocked(false);
        },
        playbackBlocked(value) {
          if (run === talkRun.current) setPlaybackBlocked(value);
        },
      });
      liveSession.current = live;
      await live.start();
      return;
    }
    setLiveVoice(false);
    const blocked = voiceBlocked();
    if (blocked) {
      setTalkNotice(VOICE_PROBLEMS[blocked]);
      return;
    }
    setOpen(false);
    cancelInteraction();
    if (target !== workspace) chooseWorkspace(target);
    // Inside the tap itself, so the replies that follow may play without another tap.
    player.current ??= primeAudio();
    const run = ++talkRun.current;
    talkActive.current = true;
    setTalkNotice('');
    setTalkHeard('');
    setTalkReply(null);
    setTalk('starting');
    try {
      const opened = await VoiceSession.open();
      if (talkRun.current !== run) {
        opened.close();
        return;
      }
      session.current = opened;
      opened.setMuted(mutedRef.current);
    } catch (problem) {
      if (talkRun.current !== run) return;
      endTalk(
        problem === 'denied'
          ? 'Microphone blocked. Allow the microphone for this site in your browser (the icon in the address bar), then tap Talk to Vexbot again.'
          : (VOICE_PROBLEMS[problem as VoiceProblem] ?? VOICE_PROBLEMS.failed),
      );
      return;
    }
    // No recorder runs during the greeting, so it cannot become a user question.
    try {
      const controller = new AbortController();
      greetingRequest.current = controller;
      const result = await api(
        'vexbot',
        { action: 'greeting', workspace_id: target },
        'POST',
        controller.signal,
      );
      if (talkRun.current !== run) return;
      greetingRequest.current = null;
      if (!result.speech)
        throw new Error(result.speech_error || 'Greeting unavailable. Retry Talk or use Ask.');
      setTalk('speaking');
      const playback = playReply(player.current!, result.speech);
      playing.current = playback;
      await playback.done;
      if (talkRun.current !== run) return;
      playing.current = null;
    } catch (error) {
      if (talkRun.current === run) endTalk((error as Error).message);
      return;
    }
    void talkLoop(run, target);
  }

  async function talkLoop(run: number, target: string | null) {
    const live = () => talkRun.current === run;
    let quiet = 0;
    while (live() && session.current) {
      const mic = session.current;
      if (mic.muted) {
        await mic.whenUnmuted();
        continue;
      }
      setTalk('listening');
      let clip: Blob | null;
      try {
        clip = await mic.listen(() => {
          if (live()) setTalk('hearing');
        });
      } catch {
        if (live())
          endTalk(
            'Microphone recording failed. Check your microphone, then retry Talk or use Ask.',
          );
        return;
      }
      if (!live()) return;
      if (!clip) {
        if (mic.muted) continue;
        // About 45 seconds without speech ends the session, so the microphone is never left open by accident.
        if (++quiet >= 3) {
          endTalk("Voice ended because I didn't hear anything. Tap Talk to Vexbot to start again.");
          return;
        }
        continue;
      }
      quiet = 0;
      setTalk('transcribing');
      let text = '';
      let savedMessage: string | undefined;
      try {
        const transcript = await api('vexbot', {
          action: 'transcribe',
          workspace_id: target,
          conversation_id: conversationRef.current,
          persist: true,
          mime: clip.type || mic.mime,
          audio: await blobToBase64(clip),
        });
        text = transcript.text;
        if (live() && transcript.conversation_id) {
          conversationRef.current = transcript.conversation_id;
          setConversation(transcript.conversation_id);
          savedMessage = transcript.user_message_id;
        }
      } catch (error) {
        if (live()) endTalk(`${(error as Error).message} Retry Talk or use Ask for text.`);
        return;
      }
      if (!live()) return;
      if (!text) {
        setTalkNotice("I didn't catch that. Please try again.");
        continue;
      }
      setTalkNotice('');
      setTalkHeard(text);
      setTalkReply(null);
      setTalk('thinking');
      let result;
      try {
        result = await api('vexbot', {
          action: 'ask',
          workspace_id: target,
          conversation_id: conversationRef.current,
          question: text,
          portal_context: {
            ...(portalSelection.current.workspace === target ? portalSelection.current : {}),
            page,
          },
          attachments: [],
          speak: true,
          medium: 'voice',
          user_message_id: savedMessage,
        });
      } catch (error) {
        if (live()) endTalk(`${(error as Error).message} Retry Talk or use Ask for text.`);
        return;
      }
      if (!live()) return;
      conversationRef.current = result.conversation.id;
      setConversation(result.conversation.id);
      setMessages((list) => [...list, ...result.messages]);
      void loadHistory(target);
      const reply = result.messages[1] as VexMessage;
      if (result.open_file) void previewSource(result.open_file, target);
      if (reply.outcome === 'unavailable') {
        endTalk(`${reply.content} Once resolved, retry Talk or use Ask.`);
        return;
      }
      setTalkReply(reply);
      if (result.speech && player.current) {
        setTalk('speaking');
        const playback = playReply(player.current, result.speech);
        playing.current = playback;
        try {
          await playback.done;
        } catch (error) {
          if (live()) endTalk((error as Error).message);
          return;
        }
        if (!live()) return;
        playing.current = null;
      } else {
        endTalk(result.speech_error || 'Spoken reply unavailable. Retry Talk or use Ask for text.');
        return;
      }
    }
  }

  function muteTalk() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setTalkMuted(next);
    session.current?.setMuted(next);
    liveSession.current?.setMuted(next);
  }

  /** Opens text chat on the voice conversation, optionally with the latest answer's sources expanded. */
  async function talkToChat(sources = false) {
    const reply = talkReply;
    await endTalk('Finishing the voice transcript…');
    openPanel();
    if (sources && reply) setRevealSources(reply.id);
  }

  prefill.current = ({ workspace: target, question: text, ...selection }) => {
    if (!admin && !access[target]) return;
    if (!open) openPanel();
    if (target !== workspace) chooseWorkspace(target);
    portalSelection.current = { ...selection, workspace: target };
    setQuestion(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  async function armWake() {
    if (wake.current) {
      wake.current.stop();
      wake.current = null;
      setWakeArmed(false);
      return;
    }
    if (
      talkActive.current ||
      status !== 'idle' ||
      voice !== 'idle' ||
      !service?.realtime?.available
    )
      return;
    const listener = new WakeWordListener(
      () => {
        wake.current = null;
        setWakeArmed(false);
        void startTalk();
      },
      (message) => {
        wake.current = null;
        setWakeArmed(false);
        setTalkNotice(message);
      },
    );
    wake.current = listener;
    try {
      await listener.start();
      if (wake.current === listener) {
        setWakeArmed(true);
        setOpen(false);
      }
    } catch (error) {
      if (wake.current !== listener) return;
      listener.stop();
      wake.current = null;
      setWakeArmed(false);
      setTalkNotice((error as Error).message);
    }
  }

  /** Shared files open straight from a citation, through the same private download the Shared files list uses. */
  async function previewSource(id: string, target: string | null) {
    const epoch = operation.current;
    if (!target) return;
    try {
      const file = unwrap(
        await db()
          .from('portal_files')
          .select('name,path,mime_type')
          .eq('id', id)
          .eq('workspace_id', target)
          .single(),
      );
      const blob = unwrap(await db().storage.from('portal-private').download(file.path));
      if (epoch !== operation.current) return;
      portalSelection.current = { workspace: target, file_id: id };
      if (
        !['application/pdf', 'text/plain'].includes(file.mime_type) &&
        !file.mime_type.startsWith('image/')
      ) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      setSourcePreview({ name: file.name, blob: new Blob([blob], { type: file.mime_type }) });
    } catch {
      setNotice('That file could not be opened. Choose it from Shared files or try again.');
    }
  }

  async function openSource(citation: Citation) {
    try {
      const file = unwrap(
        await db()
          .from('portal_files')
          .select('name,path')
          .eq('id', citation.file_id ?? citation.id ?? '')
          .single(),
      ) as { name: string; path: string };
      const blob = unwrap(await db().storage.from('portal-private').download(file.path));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice('That file is no longer available in this workspace.');
    }
  }

  const busy = status === 'thinking';
  const workspaceName =
    chosen === null ? 'Vexora knowledge' : options.find((row) => row.id === chosen)?.company;
  const statusText =
    voice === 'connecting'
      ? 'Waiting for microphone permission.'
      : voice === 'paused'
        ? 'Microphone muted. Resume or stop to send.'
        : voice === 'recording'
          ? 'Listening. Select stop when you have finished your question.'
          : voice === 'transcribing'
            ? 'Transcribing your question.'
            : busy
              ? 'Thinking.'
              : status === 'speaking'
                ? 'Answering.'
                : uploading
                  ? 'Uploading attachment.'
                  : '';
  const voiceOn = Boolean(service?.voice);

  return (
    <div
      ref={wrapper}
      className="vexbot"
      data-testid="vexbot"
      data-status={voice !== 'idle' ? voice : status}
      data-dock={dock.kind}
      data-robot={canShowRobot ? 'shown' : 'collapsed'}
      data-open={open ? '' : undefined}
      data-talk={talk}
    >
      {!hidden && (
        <canvas
          ref={canvas}
          className="vexbot-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          aria-hidden="true"
          data-testid="vexbot-canvas"
        />
      )}
      {/* Pointer shortcut only. Keyboard and screen reader users have the labelled launcher. */}
      {!hidden && stageReady && (
        <button
          ref={body}
          type="button"
          className="vexbot-body"
          tabIndex={-1}
          aria-hidden="true"
          onClick={activate}
          data-testid="vexbot-body"
        />
      )}

      <AnimatePresence initial={false}>
        {!open && (talk !== 'off' || talkNotice || wakeArmed) && (
          <m.aside
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : motionTokens.micro }}
            className="vexbot-talk-bubble"
            aria-label="Vexbot voice"
            data-testid="vexbot-talk-bubble"
            data-talk={talk}
            style={
              dock.kind === 'perch'
                ? { left: dock.rect.right + 12, top: Math.max(12, dock.rect.bottom - 190) }
                : undefined
            }
          >
            {wakeArmed && (
              <p role="status">
                Microphone active on this device. Say “{WAKE_PHRASE}”.{' '}
                <button type="button" onClick={() => void armWake()}>
                  Stop wake listening
                </button>
              </p>
            )}
            {talk !== 'off' && (
              <p className="vexbot-talk-state" role="status" data-testid="vexbot-talk-state">
                <span className="vexbot-talk-dot" aria-hidden="true" />
                {talkMuted ? 'Muted. Unmute to keep talking.' : TALK_TEXT[talk]}
                <small>
                  {liveVoice ? ' Live · Marin' : ' Recorded voice · may sound different'}
                </small>
              </p>
            )}
            {talkHeard && (
              <p className="vexbot-talk-heard" data-testid="vexbot-talk-heard">
                <span className="sr-only">You said: </span>“{talkHeard}”
              </p>
            )}
            {talkReply && (
              <div
                className="vexbot-talk-reply"
                aria-live="polite"
                data-testid="vexbot-talk-reply"
                data-outcome={talkReply.outcome}
              >
                <p>{talkReply.content}</p>
                {(talkReply.citations?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="vexbot-talk-link"
                    onClick={() => talkToChat(true)}
                    data-testid="vexbot-talk-sources"
                  >
                    <BookOpen size={13} aria-hidden="true" /> Sources:{' '}
                    {talkReply.citations!.map((c) => c.title).join(', ')}
                  </button>
                )}
              </div>
            )}
            {talkNotice && (
              <p className="vexbot-talk-notice" role="alert" data-testid="vexbot-talk-notice">
                {talkNotice}
              </p>
            )}
            {playbackBlocked && (
              <button
                type="button"
                className="vexbot-talk-control"
                onClick={() => void liveSession.current?.resumeAudio()}
              >
                Enable voice playback
              </button>
            )}
            <div className="vexbot-talk-controls">
              {talk !== 'off' && (
                <button
                  type="button"
                  className="vexbot-talk-control"
                  onClick={muteTalk}
                  aria-pressed={talkMuted}
                  data-testid="vexbot-talk-mute"
                >
                  {talkMuted ? (
                    <Mic size={15} aria-hidden="true" />
                  ) : (
                    <MicOff size={15} aria-hidden="true" />
                  )}{' '}
                  {talkMuted ? 'Unmute' : 'Mute'}
                </button>
              )}
              <button
                type="button"
                className="vexbot-talk-control"
                onClick={() => talkToChat(false)}
                data-testid="vexbot-talk-chat"
              >
                <MessageCircle size={15} aria-hidden="true" /> Open chat
              </button>
              {talk !== 'off' ? (
                <button
                  type="button"
                  className="vexbot-talk-control end"
                  onClick={() => endTalk()}
                  data-testid="vexbot-talk-end"
                >
                  <Square size={13} aria-hidden="true" /> End
                </button>
              ) : (
                <>
                  {liveVoice && (
                    <button
                      type="button"
                      className="vexbot-talk-control"
                      onClick={() => void startTalk()}
                    >
                      Reconnect voice
                    </button>
                  )}
                  {service?.voice && liveVoice && (
                    <button
                      type="button"
                      className="vexbot-talk-control"
                      onClick={() => void startTalk(true)}
                    >
                      Use recorded voice
                    </button>
                  )}
                  <button
                    type="button"
                    className="vexbot-talk-control"
                    onClick={() => setTalkNotice('')}
                    aria-label="Dismiss"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </m.aside>
        )}
      </AnimatePresence>

      {!open && (
        <div
          ref={dockRef}
          className="vexbot-dock"
          role="group"
          aria-label="Vexbot assistant"
          data-testid="vexbot-dock"
          style={
            dock.kind === 'perch'
              ? {
                  left: dock.rect.left + 16,
                  width: dock.rect.right - dock.rect.left - 32,
                  top: dock.rect.bottom + 6,
                }
              : undefined
          }
        >
          {notice && dock.kind === 'bar' && (
            <p className="vexbot-dock-status" role="status">
              {notice}
            </p>
          )}
          <button
            ref={talkRef}
            type="button"
            className={`vexbot-launcher vexbot-talk${talk !== 'off' ? ' active' : ''}`}
            onClick={() => (talk !== 'off' ? endTalk() : void startTalk())}
            aria-pressed={talk !== 'off'}
            aria-label={talk !== 'off' ? 'End voice conversation with Vexbot' : 'Talk to Vexbot'}
            data-testid="vexbot-talk"
            disabled={!service || talk === 'starting'}
          >
            {talk !== 'off' ? (
              <Square size={15} aria-hidden="true" />
            ) : (
              <Mic size={17} aria-hidden="true" />
            )}
            <span>
              {!service ? 'Checking voice?' : talk !== 'off' ? 'End voice' : 'Talk to Vexbot'}
            </span>
          </button>
          <button
            ref={launcherRef}
            type="button"
            className="vexbot-launcher secondary-launcher"
            onClick={openPanel}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="vexbot-launcher"
          >
            <MessageCircle size={17} aria-hidden="true" />
            <span>Ask Vexbot</span>
          </button>
        </div>
      )}

      <AnimatePresence onExitComplete={() => launcherRef.current?.focus()}>
        {open && (
          <m.section
            key="assistant-panel"
            initial={reduced ? false : { opacity: 0, x: sidePanel ? 12 : 0, y: sidePanel ? 0 : 12 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : motionTokens.panel, ease: motionTokens.ease }}
            ref={panelRef}
            className={sidePanel ? 'vexbot-panel side' : 'vexbot-panel sheet'}
            role="dialog"
            aria-label="Vexbot assistant"
            data-testid="vexbot-panel"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closePanel();
            }}
          >
            <header className="vexbot-header">
              {/* The character's own space. It stands here while the panel is open, never over the page. */}
              <div
                ref={stageRef}
                className={hidden || !canShowRobot ? 'vexbot-stage empty' : 'vexbot-stage'}
                aria-hidden="true"
                data-testid="vexbot-stage"
              />
              <div className="vexbot-title">
                <h2>Vexbot</h2>
                {!needsWorkspace && (
                  <label className="vexbot-workspace">
                    <span className="sr-only">Workspace</span>
                    <select
                      value={chosen ?? ''}
                      onChange={(event) => chooseWorkspace(event.target.value || null)}
                      data-testid="vexbot-workspace"
                    >
                      {admin && <option value="">Vexora knowledge only</option>}
                      {options.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.company}
                          {access[row.id] === 'read' ? ' (read-only)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {!needsWorkspace && (
                <button
                  type="button"
                  className="vexbot-icon"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  aria-expanded={historyOpen}
                  aria-label="Conversation history"
                  title="History"
                  data-testid="vexbot-history"
                >
                  <History size={18} aria-hidden="true" />
                </button>
              )}
              {!needsWorkspace && (
                <button
                  type="button"
                  className="vexbot-icon"
                  onClick={newChat}
                  aria-label="New conversation"
                  title="New conversation"
                  data-testid="vexbot-new"
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="vexbot-icon"
                onClick={closePanel}
                aria-label="Close Vexbot"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <AnimatePresence initial={false}>
              {historyOpen && (
                <m.nav
                  initial={reduced ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : motionTokens.micro }}
                  className="vexbot-history"
                  aria-label="Previous conversations"
                  data-testid="vexbot-history-list"
                >
                  {conversations.length === 0 ? (
                    <p>No previous conversations in {workspaceName}.</p>
                  ) : (
                    conversations.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className={row.id === conversation ? 'active' : ''}
                        onClick={() => void openConversation(row.id)}
                      >
                        <span>{row.title}</span>
                        <small>{new Date(row.updated_at).toLocaleDateString()}</small>
                      </button>
                    ))
                  )}
                </m.nav>
              )}
            </AnimatePresence>

            {needsWorkspace ? (
              <div className="vexbot-log" data-testid="vexbot-choose">
                <div className="vexbot-starters">
                  <p>
                    Choose the workspace you're asking about. Vexbot only uses information approved
                    for it.
                  </p>
                  <ul>
                    {admin && (
                      <li>
                        <button type="button" onClick={() => chooseWorkspace(null)}>
                          Vexora knowledge only
                        </button>
                      </li>
                    )}
                    {options.map((row) => (
                      <li key={row.id}>
                        <button type="button" onClick={() => chooseWorkspace(row.id)}>
                          {row.company}
                          {access[row.id] === 'read' ? ' · read-only' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {options.length === 0 && !admin && (
                    <p>You don't have a workspace yet. Contact Vexora for access.</p>
                  )}
                </div>
              </div>
            ) : (
              <div
                ref={logRef}
                onScroll={() => {
                  const log = logRef.current;
                  if (log)
                    followBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
                }}
                className="vexbot-log"
                role="log"
                aria-live="polite"
                aria-label="Conversation"
                tabIndex={0}
                data-testid="vexbot-log"
              >
                {messages.length === 0 && (
                  <div className="vexbot-starters">
                    <p>
                      Ask about {workspaceName}. Answers come only from Vexora's approved
                      information and published documents, with sources.
                    </p>
                    <ul>
                      {[
                        'What are your support hours?',
                        'What happens next in my project?',
                        'How do I share a file with the team?',
                      ].map((starter) => (
                        <li key={starter}>
                          <button type="button" onClick={() => ask(starter)} disabled={busy}>
                            {starter}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <AnimatePresence key={conversation} initial={false}>
                  {messages.map((message) => (
                    <m.div
                      initial={reduced ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduced ? 0 : motionTokens.micro }}
                      key={message.id}
                      className={`vexbot-message ${message.role}${message.withdrawn ? ' withdrawn' : ''}`}
                      data-testid={`vexbot-${message.role}`}
                      data-outcome={message.outcome}
                    >
                      <span className="sr-only">
                        {message.role === 'user' ? 'You asked: ' : 'Vexbot: '}
                      </span>
                      <p>{message.content}</p>
                      {message.citations && message.citations.length > 0 && (
                        <div className="vexbot-sources" data-testid="vexbot-sources">
                          <span>
                            <BookOpen size={13} aria-hidden="true" /> Sources
                          </span>
                          <ol>
                            {message.citations.map((citation) => (
                              <li
                                key={citationKey(citation)}
                                data-kind={citation.kind ?? 'document'}
                              >
                                <details open={revealSources === message.id || undefined}>
                                  <summary>
                                    {citation.kind === 'file' && (
                                      <FileText size={12} aria-hidden="true" />
                                    )}{' '}
                                    {citation.title}
                                    <small>
                                      {citation.kind === 'file'
                                        ? ' · Shared file'
                                        : ' · Approved knowledge'}
                                    </small>
                                  </summary>
                                  <blockquote>{citation.excerpt}</blockquote>
                                  {citation.kind === 'file' && (
                                    <button
                                      type="button"
                                      className="vexbot-source-open"
                                      onClick={() => void openSource(citation)}
                                    >
                                      <Download size={12} aria-hidden="true" /> Open{' '}
                                      {citation.title}
                                    </button>
                                  )}
                                </details>
                              </li>
                            ))}
                            {message.uses_profile && <li>Vexora business profile</li>}
                          </ol>
                        </div>
                      )}
                      {message.role === 'assistant' &&
                        !message.citations?.length &&
                        message.uses_profile && (
                          <div className="vexbot-sources">
                            <span>
                              <BookOpen size={13} aria-hidden="true" /> Source: Vexora business
                              profile
                            </span>
                          </div>
                        )}
                      {message.role === 'assistant' &&
                        message.outcome !== 'answered' &&
                        !message.withdrawn &&
                        !message.interrupted && (
                          <button
                            type="button"
                            className="vexbot-contact"
                            onClick={() => {
                              closePanel();
                              onMessages(chosen ?? null);
                            }}
                            data-testid="vexbot-contact"
                          >
                            <MessageSquare size={14} aria-hidden="true" /> Message the team
                          </button>
                        )}
                      {message.role === 'assistant' &&
                        voiceOn &&
                        !message.withdrawn &&
                        !message.interrupted && (
                          <button
                            type="button"
                            className="vexbot-play"
                            onClick={() => void speak(message)}
                            aria-label="Play this reply aloud"
                            title="Play aloud"
                          >
                            <Volume2 size={14} aria-hidden="true" />
                          </button>
                        )}
                    </m.div>
                  ))}
                </AnimatePresence>
                {busy && (
                  <div
                    className={`vexbot-message assistant ${partial ? '' : 'thinking'}`}
                    aria-busy="true"
                  >
                    {partial || (
                      <>
                        <Loader2 size={16} className="spin" /> Reading your workspace…
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="vexbot-status" role="status" data-testid="vexbot-status">
              {notice || statusText}
            </p>
            {busy && (
              <button
                type="button"
                className="vexbot-play"
                onClick={() => {
                  setQuestion(
                    messages.findLast((message) => message.pending && message.role === 'user')
                      ?.content ?? '',
                  );
                  cancelInteraction();
                  setNotice('Reply stopped. You can ask again.');
                }}
              >
                <Square size={14} /> Stop response
              </button>
            )}

            {!needsWorkspace && (
              <form className="vexbot-composer" onSubmit={onSubmit}>
                {attachments.length > 0 && (
                  <ul
                    className="vexbot-attachments"
                    aria-label="Attachments"
                    data-testid="vexbot-attachments"
                  >
                    <AnimatePresence initial={false}>
                      {attachments.map((row) => (
                        <m.li
                          initial={reduced ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduced ? 0 : motionTokens.micro }}
                          key={row.id}
                          data-status={row.status}
                        >
                          <Paperclip size={13} aria-hidden="true" />
                          <span>{row.name}</span>
                          <small>{UPLOAD_STATUS[row.status]}</small>
                          <button
                            type="button"
                            className="vexbot-icon small"
                            aria-label={`Remove ${row.name}`}
                            onClick={() =>
                              setAttachments((list) => list.filter((item) => item.id !== row.id))
                            }
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </m.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
                <div className="vexbot-input">
                  <label className="sr-only" htmlFor="vexbot-question">
                    Message Vexbot
                  </label>
                  <textarea
                    ref={inputRef}
                    id="vexbot-question"
                    value={question}
                    rows={1}
                    maxLength={2000}
                    placeholder={
                      voice === 'recording' ? 'Listening…' : `Message Vexbot about ${workspaceName}`
                    }
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={onComposerKey}
                    disabled={voice !== 'idle'}
                    enterKeyHint="send"
                    data-testid="vexbot-input"
                  />
                  <div className="vexbot-actions">
                    {writable && chosen && (
                      <>
                        <input
                          ref={fileRef}
                          type="file"
                          hidden
                          multiple
                          accept={UPLOAD_ACCEPT}
                          onChange={attach}
                          data-testid="vexbot-file"
                        />
                        <button
                          type="button"
                          className="vexbot-icon"
                          onClick={() => fileRef.current?.click()}
                          disabled={attachments.length >= 5 || voice !== 'idle'}
                          aria-label="Attach files"
                          title={UPLOAD_HINT}
                        >
                          <Paperclip size={18} aria-hidden="true" />
                        </button>
                      </>
                    )}
                    {voiceOn && (
                      <button
                        type="button"
                        className={`vexbot-icon${voice === 'recording' ? ' recording' : ''}`}
                        onClick={() => void toggleVoice()}
                        aria-pressed={voice === 'recording'}
                        disabled={voice === 'transcribing' || voice === 'connecting' || busy}
                        aria-label={
                          voice === 'recording' || voice === 'paused'
                            ? 'Stop recording and send'
                            : 'Ask by voice'
                        }
                        title={voice === 'recording' ? 'Stop and send' : 'Ask by voice'}
                        data-testid="vexbot-mic"
                      >
                        {voice === 'recording' || voice === 'paused' ? (
                          <Square size={16} aria-hidden="true" />
                        ) : (
                          <Mic size={18} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {(voice === 'recording' || voice === 'paused') && (
                      <>
                        <button
                          type="button"
                          className="vexbot-icon"
                          aria-label={voice === 'paused' ? 'Resume microphone' : 'Mute microphone'}
                          aria-pressed={voice === 'paused'}
                          onClick={() => {
                            const muted = voice !== 'paused';
                            recorder.current?.mute(muted);
                            setVoice(muted ? 'paused' : 'recording');
                          }}
                        >
                          <Mic size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="vexbot-icon"
                          aria-label="Cancel recording"
                          onClick={cancelInteraction}
                        >
                          <X size={18} aria-hidden="true" />
                        </button>
                      </>
                    )}
                    {status === 'speaking' && (
                      <button
                        type="button"
                        className="vexbot-icon"
                        aria-label="Stop spoken reply"
                        onClick={() => {
                          stopAudio();
                          setStatus('idle');
                        }}
                      >
                        <Square size={16} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="submit"
                      className="vexbot-send"
                      disabled={busy || !question.trim() || uploading > 0 || voice !== 'idle'}
                      aria-label="Send message"
                      data-testid="vexbot-send"
                    >
                      <ArrowUp size={18} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="vexbot-controls" role="group" aria-label="Vexbot settings">
              {(service?.realtime?.available || voiceOn) && !needsWorkspace && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startTalk()}
                  data-testid="vexbot-start-conversation"
                >
                  Start voice conversation
                </button>
              )}
              <button
                type="button"
                aria-pressed={still}
                onClick={() => updatePreferences({ still: !still })}
                data-testid="vexbot-still"
              >
                Keep still
              </button>
              <button
                type="button"
                aria-pressed={hidden}
                onClick={() => updatePreferences({ hidden: !hidden })}
                data-testid="vexbot-hide"
              >
                Hide robot
              </button>
              {voiceOn && (
                <button
                  type="button"
                  aria-pressed={preferences.speak}
                  onClick={() => updatePreferences({ speak: !preferences.speak })}
                  data-testid="vexbot-speak"
                >
                  Spoken replies
                </button>
              )}
              <button
                type="button"
                disabled={
                  !wakeSupported ||
                  !service?.realtime?.available ||
                  talk !== 'off' ||
                  status !== 'idle' ||
                  voice !== 'idle'
                }
                aria-pressed={wakeArmed}
                onClick={() => void armWake()}
                title={
                  wakeSupported
                    ? 'Uses on-device recognition; stops before Vexbot speaks.'
                    : 'On-device wake recognition is unavailable. Tap Talk to Vexbot instead.'
                }
              >
                Listen for “{WAKE_PHRASE}”
              </button>
            </div>
            {admin && (
              <>
                {service?.realtime && !service.realtime.available && (
                  <details className="vexbot-disclosure">
                    <summary>Live voice availability</summary>
                    {service.realtime.reason}
                  </details>
                )}
                <p className="vexbot-disclosure">
                  AI assistant. It answers only from information Vexora has approved and cites its
                  sources; the team confirms anything important.
                  {
                    ' Conversations and available transcripts are saved for authorised Vexora administrators.'
                  }
                  {service?.realtime?.available
                    ? ' Live voice streams microphone audio to OpenAI while connected. You can interrupt, mute or end at any time. Conversations, available transcripts and summaries are saved for authorised Vexora administrators. Microphone recordings are not stored by the portal.'
                    : voiceOn
                      ? ' Recorded voice works one question at a time and may use a different voice from the website. Recordings go to the AI provider for transcription and are not stored by the portal.'
                      : ''}
                  {service?.provider === 'mock'
                    ? ' Local test mode: answers come from a mock provider.'
                    : ''}
                </p>
              </>
            )}
          </m.section>
        )}
      </AnimatePresence>
      <dialog
        ref={sourceDialog}
        className="document-preview-dialog"
        aria-label={sourcePreview ? `Preview ${sourcePreview.name}` : 'Document preview'}
        onClose={() => setSourcePreview(null)}
      >
        <div className="panel-heading">
          <h2>{sourcePreview?.name}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close document preview"
            onClick={() => sourceDialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {sourcePreview && (
          <Suspense fallback={<p role="status">Loading preview…</p>}>
            <DocumentPreview blob={sourcePreview.blob} name={sourcePreview.name} />
          </Suspense>
        )}
      </dialog>
    </div>
  );
}
