import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { api } from '../services/portal';
import {
  activityLabel,
  portalTime,
  targetForNotification,
  type AdminNotification,
  type InsightTarget,
} from '../services/activity';
import type { Overview } from '../services/use-admin-insights';
import type { Client } from '../types/portal';

type Shared = { clients: Client[]; timezone: string; onNavigate: (target: InsightTarget) => void };
export function NotificationBell({
  clients,
  timezone,
  onNavigate,
  unread,
  onChange,
}: { unread: number; onChange: () => Promise<void> } & Shared) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<AdminNotification[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [open, setOpen] = useState(false);
  const load = useCallback(async (page = 0) => {
    setLoading(true);
    setError('');
    try {
      const r = await api('insights', { action: 'notifications', offset: page });
      setRows(r.notifications);
      setMore(r.notifications.length === 40);
      setOffset(page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open) void load(offset);
  }, [open, unread, load, offset]);
  async function mark(n?: AdminNotification, unread = false) {
    try {
      await api(
        'insights',
        n
          ? { action: 'notification_read', notification_id: n.id, unread }
          : { action: 'mark_all_read' },
      );
      await Promise.all([load(offset), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <button
        className="icon-button notification-bell"
        aria-label={`Admin notifications, ${unread} unread`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Bell size={20} />
        {unread > 0 && <span className="notification-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <dialog
        className="notification-dialog"
        ref={dialog}
        aria-labelledby="notification-title"
        onClose={() => setOpen(false)}
      >
        <div className="panel-heading">
          <h2 id="notification-title">
            Notifications <span className="count">{unread} unread</span>
          </h2>
          <button
            className="icon-button"
            aria-label="Close notifications"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        <div className="button-row">
          <button className="secondary" disabled={loading} onClick={() => void mark()}>
            Mark all as read
          </button>
          <button className="secondary" disabled={loading} onClick={() => void load(offset)}>
            Refresh notifications
          </button>
        </div>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {loading && <p role="status">Loading notifications…</p>}
        {!rows.length && !loading && (
          <p className="empty compact">
            You’re all caught up. New client messages and completed summaries will appear here.
          </p>
        )}
        <ul className="insight-list">
          {rows.map((n) => (
            <li key={n.id} className={n.unread ? 'is-unread' : ''}>
              <button
                className="insight-record"
                onClick={() => {
                  void mark(n);
                  dialog.current?.close();
                  onNavigate(targetForNotification(n));
                }}
              >
                <span>
                  <strong>
                    {n.unread && <span className="unread-dot" aria-label="Unread" />}
                    {n.title}
                  </strong>
                  <small>
                    {clients.find((c) => c.id === n.workspace_id)?.company || 'Client'} ·{' '}
                    {n.vexbot_conversations?.kind
                      ? `${n.vexbot_conversations.kind} conversation`
                      : activityLabel(n.kind)}{' '}
                    · {portalTime(n.created_at, timezone)}
                  </small>
                  <p>{n.preview}</p>
                  <span className="text-button">
                    {n.thread_id
                      ? 'View message'
                      : n.conversation_id
                        ? 'View conversation'
                        : 'View client activity'}
                  </span>
                </span>
              </button>
              <button
                className="text-button notification-read"
                onClick={() => void mark(n, !n.unread)}
              >
                {n.unread ? 'Mark as read' : 'Mark unread'}
              </button>
            </li>
          ))}
        </ul>
        <div className="button-row insight-pagination">
          <button
            className="secondary"
            disabled={!offset || loading}
            onClick={() => void load(offset - 40)}
          >
            Previous
          </button>
          <span>Page {offset / 40 + 1}</span>
          <button
            className="secondary"
            disabled={!more || loading}
            onClick={() => void load(offset + 40)}
          >
            Next
          </button>
        </div>
      </dialog>
    </>
  );
}
export function AdminActivityOverview({
  overview,
  error,
  onRefresh,
  clients,
  timezone,
  onNavigate,
}: { overview: Overview | null; error: string; onRefresh: () => Promise<void> } & Shared) {
  const [settings, setSettings] = useState(false),
    [zone, setZone] = useState(timezone),
    [rules, setRules] = useState<{ action: string; enabled: boolean }[]>([]),
    [notice, setNotice] = useState('');
  const [attention, setAttention] = useState(''),
    [items, setItems] = useState<AdminNotification[]>([]),
    [attentionOffset, setAttentionOffset] = useState(0),
    [attentionLoading, setAttentionLoading] = useState(false),
    [attentionMore, setAttentionMore] = useState(false);
  async function showAttention(category: string, offset = 0) {
    setAttention(category);
    setAttentionLoading(true);
    setNotice('');
    try {
      const r = await api('insights', { action: 'attention', category, offset });
      setItems(r.items);
      setAttentionOffset(offset);
      setAttentionMore(r.items.length === 40);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setAttentionLoading(false);
    }
  }
  useEffect(() => setZone(timezone), [timezone]);
  async function configure() {
    setSettings((v) => !v);
    try {
      const r = await api('insights', { action: 'rules' });
      setRules(r.rules);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function preference() {
    try {
      await api('insights', { action: 'preferences', timezone: zone });
      await onRefresh();
      setNotice('Timezone saved.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function rule(action: string, enabled: boolean) {
    try {
      await api('insights', { action: 'rule', event: action, enabled });
      setRules((old) => [...old.filter((r) => r.action !== action), { action, enabled }]);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <section className="panel admin-activity-overview" aria-label="Client activity overview">
      <div className="panel-heading">
        <div>
          <h2>Client activity & follow-up</h2>
          <p>Messages, VexBot summaries and recent activity.</p>
        </div>
        <button className="text-button" onClick={() => void configure()}>
          Notification settings
        </button>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void onRefresh()}>
            Retry updates
          </button>
        </p>
      )}
      {overview && (
        <>
          <div className="insight-counts">
            <button onClick={() => void showAttention('messages')}>
              <strong>{overview.counts.messages}</strong>Unread client messages
            </button>
            <button onClick={() => void showAttention('summaries')}>
              <strong>{overview.counts.summaries}</strong>New summaries
            </button>
            <button onClick={() => void showAttention('follow_up')}>
              <strong>{overview.counts.follow_up}</strong>Requires follow-up
            </button>
          </div>
          {attention && (
            <section className="insight-attention" aria-label="Items requiring attention">
              <div className="panel-heading">
                <h3>
                  {attention === 'messages'
                    ? 'Unread client messages'
                    : attention === 'summaries'
                      ? 'New summaries'
                      : 'Conversations requiring follow-up'}
                </h3>
                <button className="text-button" onClick={() => setAttention('')}>
                  Close list
                </button>
              </div>
              {attentionLoading ? (
                <p role="status">Loading items…</p>
              ) : !items.length ? (
                <p>No items requiring attention.</p>
              ) : (
                items.map((n) => (
                  <button
                    className="insight-mini"
                    key={n.id}
                    onClick={() => onNavigate(targetForNotification(n))}
                  >
                    <strong>
                      {clients.find((c) => c.id === n.workspace_id)?.company} · {n.title}
                    </strong>
                    <span>{n.preview}</span>
                    <small>{portalTime(n.created_at, timezone)}</small>
                  </button>
                ))
              )}
              {notice && <p role="alert">{notice}</p>}
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!attentionOffset || attentionLoading}
                  onClick={() => void showAttention(attention, attentionOffset - 40)}
                >
                  Previous items
                </button>
                <button
                  className="secondary"
                  disabled={!attentionMore || attentionLoading}
                  onClick={() => void showAttention(attention, attentionOffset + 40)}
                >
                  Next items
                </button>
              </div>
            </section>
          )}
          <div className="insight-overview-columns">
            <div>
              <h3>Latest notifications</h3>
              {!overview.notifications.length && <p>No notifications yet.</p>}
              {overview.notifications.map((n) => (
                <button
                  className="insight-mini"
                  key={n.id}
                  onClick={() => onNavigate(targetForNotification(n))}
                >
                  <strong>
                    {clients.find((c) => c.id === n.workspace_id)?.company} · {n.title}
                  </strong>
                  <span>{n.preview}</span>
                  <small>{portalTime(n.created_at, timezone)}</small>
                </button>
              ))}
            </div>
            <div>
              <h3>Recent activity</h3>
              {!overview.events.length && <p>No client activity recorded yet.</p>}
              {overview.events.map((e) => (
                <button
                  className="insight-mini"
                  key={e.id}
                  onClick={() =>
                    onNavigate({ workspace: e.workspace_id, tab: 'activity', activity: e.id })
                  }
                >
                  <strong>
                    {e.client_name} · {activityLabel(e.action)}
                  </strong>
                  <span>{e.target_name}</span>
                  <small>{portalTime(e.created_at, timezone)}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {settings && (
        <div className="insight-settings">
          <label>
            Administrator timezone
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Pacific/Auckland"
            />
          </label>
          <button className="secondary" onClick={() => void preference()}>
            Save timezone
          </button>
          <h3>Notify for important activity</h3>
          <p>
            All activity notifications are off until selected here. Messages and completed summaries
            always notify.
          </p>
          {[
            'login',
            'document_downloaded',
            'document_opened',
            'document_previewed',
            'video_opened',
            'file_uploaded',
          ].map((action) => (
            <label className="insight-check" key={action}>
              <input
                type="checkbox"
                checked={rules.some((r) => r.action === action && r.enabled)}
                onChange={(e) => void rule(action, e.target.checked)}
              />
              {activityLabel(action)}
            </label>
          ))}
          {notice && <p role="status">{notice}</p>}
        </div>
      )}
    </section>
  );
}
