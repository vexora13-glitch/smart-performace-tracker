import { api } from './portal';

export const ACTIVITY_TYPES = [
  'login',
  'logout',
  'workspace_opened',
  'document_opened',
  'document_previewed',
  'document_downloaded',
  'video_opened',
  'chapter_selected',
  'message_sent',
  'text_started',
  'text_completed',
  'voice_started',
  'voice_completed',
  'file_uploaded',
] as const;
export const activityLabel = (action: string) => action.replaceAll('_', ' ');
export type ActivityEvent = {
  id: string;
  workspace_id: string;
  actor_id: string;
  client_name: string;
  action: string;
  target_id: string | null;
  target_name: string;
  session_id: string;
  metadata: Record<string, string | number>;
  created_at: string;
};
export type AdminNotification = {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  preview: string;
  created_at: string;
  conversation_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  activity_id: string | null;
  unread: boolean;
  vexbot_conversations?: { kind: string } | null;
};
export type InsightTarget = {
  workspace: string;
  tab: 'workspace' | 'activity' | 'conversations' | 'messages';
  conversation?: string;
  thread?: string;
  message?: string;
  activity?: string;
};
export function targetForNotification(n: AdminNotification): InsightTarget {
  return {
    workspace: n.workspace_id,
    tab: n.conversation_id ? 'conversations' : n.thread_id ? 'messages' : 'activity',
    conversation: n.conversation_id || undefined,
    thread: n.thread_id || undefined,
    message: n.message_id || undefined,
    activity: n.activity_id || undefined,
  };
}
export function insightHash(target: InsightTarget) {
  const params = new URLSearchParams({ client: target.workspace, tab: target.tab });
  for (const key of ['conversation', 'thread', 'message', 'activity'] as const)
    if (target[key]) params.set(key, target[key]);
  return `#${params}`;
}
export function portalTime(value: string, timezone = 'Pacific/Auckland') {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
/** Convert midnight on a calendar date in the administrator's timezone to UTC, including DST. */
export function dateBoundary(date: string, timezone: string, nextDay = false) {
  const [y, m, d] = date.split('-').map(Number);
  const wanted = new Date(Date.UTC(y, m - 1, d + (nextDay ? 1 : 0)));
  let guess = wanted.getTime();
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    guess += wanted.getTime() - represented;
  }
  return new Date(guess).toISOString();
}

type TrackInput = {
  event: string;
  workspace_id: string;
  file_id?: string;
  chapter_id?: string;
  upload_id?: string;
};
type Pending = TrackInput & { action: 'event'; event_id: string; session_id: string };
const pending = new Map<string, Pending>();
export function clearActivityQueue() {
  pending.clear();
  clearTimeout(timer);
  retries = 0;
}
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
let retries = 0;
function browserSession() {
  try {
    const key = 'vexora-activity-session-v1';
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return crypto.randomUUID();
  }
}
async function flush() {
  if (flushing) return;
  flushing = true;
  for (const [key, event] of pending) {
    try {
      await api('insights', event);
      pending.delete(key);
      retries = 0;
    } catch {
      retries++;
      break;
    }
  }
  flushing = false;
  if (pending.size && retries < 5)
    timer = setTimeout(() => void flush(), Math.min(30000, 1000 * 2 ** retries));
}
/** Bounded, asynchronous telemetry. Never delays or throws into a client interaction. */
export function trackActivity(input: TrackInput, dedup?: string) {
  const key = dedup || crypto.randomUUID();
  if (pending.has(key)) return;
  if (pending.size >= 100) pending.delete(pending.keys().next().value!);
  pending.set(key, {
    ...input,
    action: 'event',
    event_id: crypto.randomUUID(),
    session_id: browserSession(),
  });
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 100);
}
export async function recordLogout(workspace: string) {
  // Bounded wait before token revocation; logout still succeeds if telemetry is unavailable.
  await Promise.race([
    api('insights', {
      action: 'event',
      event: 'logout',
      workspace_id: workspace,
      event_id: crypto.randomUUID(),
      session_id: browserSession(),
    }).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 600)),
  ]);
}
export function completeVexbot(conversation: string | null) {
  if (!conversation) return;
  void api('vexbot', { action: 'complete', conversation_id: conversation }).catch(() => {
    // A server-side inactivity sweep is the durable fallback when the browser is gone.
  });
}
