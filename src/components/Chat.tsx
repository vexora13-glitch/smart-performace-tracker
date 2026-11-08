import { useEffect, useState, type FormEvent } from 'react';
import { Archive, CheckCheck, MessageSquare, Plus, Send } from 'lucide-react';
import { api, db, unread, unwrap } from '../services/portal';
import type { PortalData, Profile } from '../types/portal';

export function Chat({
  profile,
  data,
  refresh,
  workspaceId,
  readOnly = false,
}: {
  profile: Profile;
  data: PortalData;
  refresh: () => Promise<void>;
  workspaceId?: string;
  /** Read-only workspace members can read conversations but not start or reply to them. */
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const conversation = data.conversations.find((row) => row.id === selected);
  const rows = data.conversations.filter(
    (row) => (!workspaceId || row.workspace_id === workspaceId) && !!row.archived_at === archived,
  );
  const messages = data.messages.filter((row) => row.conversation_id === selected);
  const incomingVersion = messages
    .filter((row) => row.author_id !== profile.id)
    .map((row) => row.id)
    .join(',');
  useEffect(() => {
    setSelected(null);
    setComposing(false);
    setDraft('');
  }, [workspaceId]);
  useEffect(() => {
    if (!selected || document.visibilityState !== 'visible') return;
    let active = true;
    const mark = async () => {
      try {
        unwrap(await db().rpc('portal_mark_read', { conversation: selected }));
        if (active) await refresh();
      } catch {
        if (active) setError('Unable to mark this conversation as read.');
      }
    };
    void mark();
    const visible = () => {
      if (document.visibilityState === 'visible') void mark();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [selected, incomingVersion, refresh]);
  async function notify(messageId: string) {
    if (profile.role !== 'client') return;
    try {
      await api('notifications', { messageId });
    } catch {
      setNotice('Message sent. The email notification is queued for delivery.');
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = unwrap(
        await db().rpc('portal_start_conversation', {
          workspace: workspaceId || input.get('workspace'),
          title: String(input.get('subject')).trim(),
          body: String(input.get('body')).trim(),
        }),
      ) as { conversation_id: string; message_id: string }[];
      setSelected(result[0].conversation_id);
      setComposing(false);
      setArchived(false);
      setDraft('');
      await refresh();
      await notify(result[0].message_id);
    } catch (error) {
      setError((error as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = unwrap(
        await db()
          .from('portal_messages')
          .insert({ conversation_id: conversation.id, author_id: profile.id, body: draft.trim() })
          .select('id')
          .single(),
      );
      setDraft('');
      await refresh();
      await notify(row.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!conversation) return;
    setBusy(true);
    setError('');
    try {
      unwrap(
        await db()
          .from('portal_conversations')
          .update({ archived_at: conversation.archived_at ? null : new Date().toISOString() })
          .eq('id', conversation.id),
      );
      setArchived(!conversation.archived_at);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const receipt =
    data.reads
      .filter((row) => row.conversation_id === selected && row.user_id !== profile.id)
      .map((row) => row.last_read_at)
      .sort()
      .at(-1) || '';
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <section className="chat-layout panel">
        <aside className="chat-sidebar">
          <div className="panel-heading">
            <h2>Conversations</h2>
            <button
              className="icon-button"
              aria-label="New conversation"
              hidden={readOnly}
              disabled={data.clients.length === 0 || readOnly}
              onClick={() => {
                setComposing(true);
                setSelected(null);
                setError('');
              }}
            >
              <Plus size={20} />
            </button>
          </div>
          <div className="tabs">
            <button
              className={!archived ? 'selected' : ''}
              onClick={() => {
                setArchived(false);
                setSelected(null);
                setComposing(false);
              }}
            >
              Active
            </button>
            <button
              className={archived ? 'selected' : ''}
              onClick={() => {
                setArchived(true);
                setSelected(null);
                setComposing(false);
              }}
            >
              Archived
            </button>
          </div>
          {rows.length === 0 && (
            <div className="empty compact">
              <MessageSquare size={23} />
              <p>
                {archived
                  ? 'No archived conversations.'
                  : 'Start a conversation when you’re ready.'}
              </p>
            </div>
          )}
          {rows.map((row) => (
            <button
              key={row.id}
              className={`thread-row ${row.id === selected ? 'selected' : ''}`}
              onClick={() => {
                setSelected(row.id);
                setComposing(false);
                setDraft('');
                setNotice('');
              }}
            >
              <span className="row-copy">
                <strong>{row.subject}</strong>
                <small>
                  {data.clients.find((client) => client.id === row.workspace_id)?.company}
                </small>
              </span>
              {unread(row.id, data, profile.id) > 0 && (
                <span className="nav-count">{unread(row.id, data, profile.id)}</span>
              )}
            </button>
          ))}
        </aside>
        <div className="chat-content">
          {composing ? (
            <form className="new-conversation" onSubmit={create}>
              <div className="eyebrow">A DIRECT CONNECTION</div>
              <h2>Start a conversation.</h2>
              {!workspaceId && (
                <label>
                  Client
                  <select name="workspace" required>
                    <option value="">Choose a client</option>
                    {data.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.company}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Subject
                <input name="subject" required maxLength={160} />
              </label>
              <label>
                Your message
                <textarea name="body" required maxLength={10000} rows={6} />
              </label>
              <div className="button-row">
                <button disabled={busy}>
                  <Send size={16} />
                  {busy ? 'Sending…' : 'Send message'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setComposing(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : conversation ? (
            <>
              <div className="chat-heading">
                <div>
                  <h2>{conversation.subject}</h2>
                  <small>
                    {
                      data.clients.find((client) => client.id === conversation.workspace_id)
                        ?.company
                    }{' '}
                    · {conversation.archived_at ? 'Archived' : 'Private conversation'}
                  </small>
                </div>
                {profile.role === 'admin' && (
                  <button className="secondary" disabled={busy} onClick={archive}>
                    <Archive size={15} />
                    {conversation.archived_at ? 'Reopen' : 'Archive'}
                  </button>
                )}
              </div>
              <div className="message-history" role="log" aria-label="Conversation messages">
                {messages.length === 0 && <p>No messages yet. Send the first one below.</p>}
                {messages.map((row) => {
                  const own = row.author_id === profile.id;
                  return (
                    <article className={`message ${own ? 'own' : ''}`} key={row.id}>
                      <small>
                        {own
                          ? 'You'
                          : row.author_id === conversation.workspace_id
                            ? 'Client'
                            : 'Vexora'}{' '}
                        · {new Date(row.created_at).toLocaleString()}
                      </small>
                      <p>{row.body}</p>
                      {own && (
                        <span className="read-receipt">
                          <CheckCheck size={13} />
                          {receipt >= row.created_at ? 'Read' : 'Sent'}
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
              {conversation.archived_at ? (
                <div className="archived-note">
                  <Archive size={16} />
                  This conversation is archived. Its history is available to read.
                </div>
              ) : readOnly ? (
                <div className="archived-note" data-testid="read-only-note">
                  You have read-only access to this workspace, so you can read but not reply.
                </div>
              ) : (
                <form className="message-composer" onSubmit={send}>
                  <label className="sr-only" htmlFor="reply">
                    Your reply
                  </label>
                  <textarea
                    id="reply"
                    placeholder="Write your reply…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    required
                    maxLength={10000}
                    rows={3}
                  />
                  <button disabled={busy || !draft.trim()}>
                    <Send size={17} />
                    {busy ? 'Sending…' : 'Send'}
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="empty chat-empty">
              <span className="stat-icon">
                <MessageSquare size={30} />
              </span>
              <h2>A conversation away.</h2>
              <p>
                {readOnly
                  ? 'Choose a conversation to read. Your access is read-only.'
                  : 'Choose a conversation or start something new.'}
              </p>
              {!readOnly && (
                <button disabled={data.clients.length === 0} onClick={() => setComposing(true)}>
                  <Plus size={16} />
                  New conversation
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
