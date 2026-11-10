import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/portal';
import {
  ACTIVITY_TYPES,
  activityLabel,
  dateBoundary,
  portalTime,
  type ActivityEvent,
} from '../services/activity';

type Point = { text: string; evidence: { message_id: string; quote: string }[] };
type Summary = { overview: string; partial_transcript?: boolean } & Record<
  string,
  string | boolean | Point[] | undefined
>;
type Conversation = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  kind: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  partial_transcript: boolean;
  summary_status: string;
  summary_preview: string;
  summary_error?: string;
  summary: Summary | null;
  follow_up: string;
  unread: boolean;
  revision: number;
};
type Transcript = {
  id: string;
  role: string;
  content: string;
  medium: string;
  created_at: string;
  attachments: string[];
  vexbot_citations: { document_id: string; vexbot_documents: { title: string } | null }[];
  vexbot_file_citations: { file_id: string; file_name: string }[];
};
const sections = {
  key_questions: 'Key questions',
  information_provided: 'Information provided',
  client_requests: 'Client requests',
  outstanding_questions: 'Outstanding questions',
  follow_up_required: 'Follow-up required',
  referenced_documents: 'Referenced documents',
};

export function ClientActivity({
  workspace,
  timezone,
  highlight,
}: {
  workspace: string;
  timezone: string;
  highlight?: string;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]),
    [type, setType] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [retry, setRetry] = useState(0);
  const [focused, setFocused] = useState(highlight);
  useEffect(() => setFocused(highlight), [highlight]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api('insights', {
      action: 'activity',
      workspace_id: workspace,
      highlight: focused,
      type,
      from: from ? dateBoundary(from, timezone) : undefined,
      to: to ? dateBoundary(to, timezone, true) : undefined,
      offset,
    })
      .then((result) => {
        if (active) {
          setEvents(result.events);
          setMore(result.events.length === 40);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace, type, from, to, offset, timezone, retry, focused]);
  return (
    <section className="panel insights-panel" aria-label="Client activity">
      <div className="panel-heading">
        <div>
          <h2>Activity</h2>
          <p>Meaningful portal interactions · {timezone}</p>
        </div>
        <button className="secondary" onClick={() => setRetry((v) => v + 1)}>
          Refresh activity
        </button>
      </div>
      {focused && (
        <button className="text-button" onClick={() => setFocused(undefined)}>
          Show all client activity
        </button>
      )}
      <div className="insight-filters">
        <label>
          Action
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All actions</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {activityLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading activity…</p>
      ) : events.length === 0 ? (
        <p className="empty compact">No activity matches these filters.</p>
      ) : (
        <ol className="activity-timeline">
          {events.map((event) => (
            <li key={event.id} className={event.id === highlight ? 'insight-highlight' : ''}>
              <strong>{event.client_name}</strong> <span>{activityLabel(event.action)}</span>
              {event.target_name && <span> · {event.target_name}</span>}
              {event.metadata.chapter_title && <span> · {event.metadata.chapter_title}</span>}
              {event.metadata.document_category && (
                <span className="pill">
                  {activityLabel(String(event.metadata.document_category))}
                </span>
              )}
              <time dateTime={event.created_at}>{portalTime(event.created_at, timezone)}</time>
              <details>
                <summary>Activity details</summary>
                <small>
                  Client workspace: {event.workspace_id}
                  <br />
                  Client user: {event.actor_id}
                  <br />
                  Session: {event.session_id}
                </small>
              </details>
            </li>
          ))}
        </ol>
      )}
      <Pagination offset={offset} size={40} more={more} loading={loading} onChange={setOffset} />
    </section>
  );
}
function Pagination({
  offset,
  size,
  more,
  loading,
  onChange,
}: {
  offset: number;
  size: number;
  more: boolean;
  loading: boolean;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="button-row insight-pagination">
      <button
        className="secondary"
        disabled={!offset || loading}
        onClick={() => onChange(Math.max(0, offset - size))}
      >
        Previous
      </button>
      <span>Page {Math.floor(offset / size) + 1}</span>
      <button
        className="secondary"
        disabled={!more || loading}
        onClick={() => onChange(offset + size)}
      >
        Next
      </button>
    </div>
  );
}
export function ClientConversations({
  workspace,
  timezone,
  selected,
  onSelect,
}: {
  workspace: string;
  timezone: string;
  selected?: string;
  onSelect: (id?: string) => void;
}) {
  const [rows, setRows] = useState<Conversation[]>([]),
    [search, setSearch] = useState(''),
    [follow, setFollow] = useState(false),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      void api('insights', {
        action: 'conversations',
        workspace_id: workspace,
        search,
        follow_up: follow,
        offset,
      })
        .then((r) => {
          if (active) {
            setRows(r.conversations);
            setMore(r.conversations.length === 40);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [workspace, search, follow, offset, retry]);
  if (selected)
    return (
      <ConversationDetail
        key={`${workspace}:${selected}`}
        workspace={workspace}
        conversationId={selected}
        timezone={timezone}
        onBack={() => {
          onSelect();
          setRetry((v) => v + 1);
        }}
      />
    );
  return (
    <section className="panel insights-panel" aria-label="VexBot conversations">
      <div className="panel-heading">
        <div>
          <h2>VexBot Conversations</h2>
          <p>Saved text and available voice transcripts.</p>
        </div>
        <button className="secondary" onClick={() => setRetry((v) => v + 1)}>
          Refresh conversations
        </button>
      </div>
      <div className="insight-filters">
        <label>
          Search conversations
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Search titles and summaries"
          />
        </label>
        <label className="insight-check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked);
              setOffset(0);
            }}
          />
          Requires follow-up
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading conversations…</p>
      ) : !rows.length ? (
        <p className="empty compact">No conversations match this search.</p>
      ) : (
        <ul className="insight-list">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                className={`insight-record ${c.unread ? 'is-unread' : ''}`}
                onClick={() => onSelect(c.id)}
              >
                <span>
                  <strong>
                    {c.unread && <span aria-label="Unread" className="unread-dot" />}
                    {c.title}
                  </strong>
                  <small>
                    {portalTime(c.created_at, timezone)} · {c.kind} ·{' '}
                    {c.ended_at
                      ? `${Math.max(0, Math.round((Date.parse(c.ended_at) - Date.parse(c.created_at)) / 60000))} min`
                      : 'In progress'}
                  </small>
                  <p>
                    {c.summary_preview ||
                      `Summary ${c.status === 'active' ? 'available when the session ends' : c.summary_status}.`}
                  </p>
                </span>
                <span className="pill">
                  {c.follow_up === 'required'
                    ? 'Follow-up required'
                    : c.follow_up === 'resolved'
                      ? 'Resolved'
                      : c.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination offset={offset} size={40} more={more} loading={loading} onChange={setOffset} />
    </section>
  );
}
function ConversationDetail({
  workspace,
  conversationId,
  timezone,
  onBack,
}: {
  workspace: string;
  conversationId: string;
  timezone: string;
  onBack: () => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<Transcript[]>([]),
    [author, setAuthor] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const load = useCallback(
    async (offset = 0) => {
      const request = ++epoch.current;
      setLoading(true);
      setError('');
      try {
        const r = await api('insights', {
          action: 'conversation',
          workspace_id: workspace,
          conversation_id: conversationId,
          offset,
        });
        if (request !== epoch.current) return;
        setConversation(r.conversation);
        setAuthor(r.author || 'Client');
        setMessages((previous) => (offset ? [...previous, ...r.messages] : r.messages));
        setMore(r.messages.length === 100);
        if (!offset)
          await api('insights', {
            action: 'conversation_read',
            workspace_id: workspace,
            conversation_id: conversationId,
          });
      } catch (e) {
        if (request === epoch.current) setError((e as Error).message);
      } finally {
        if (request === epoch.current) setLoading(false);
      }
    },
    [workspace, conversationId],
  );
  useEffect(() => {
    const currentEpoch = epoch;
    void load();
    return () => {
      currentEpoch.current++;
    };
  }, [load, retry]);
  async function change(action: string, extra: object = {}) {
    setBusy(true);
    setError('');
    try {
      await api('insights', {
        action,
        workspace_id: workspace,
        conversation_id: conversationId,
        ...extra,
      });
      if (action === 'conversation_read') onBack();
      else setRetry((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel insights-panel" aria-label="VexBot conversation detail">
      <div className="panel-heading">
        <button className="secondary" onClick={onBack}>
          Back to conversations
        </button>
        <button className="secondary" disabled={loading} onClick={() => setRetry((v) => v + 1)}>
          Refresh conversation
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!conversation && loading && <p role="status">Loading conversation…</p>}
      {conversation && (
        <>
          <h2>{conversation.title}</h2>
          <p>
            {author} · {conversation.kind} · {portalTime(conversation.created_at, timezone)}
            {conversation.ended_at && ` – ${portalTime(conversation.ended_at, timezone)}`}
          </p>
          <div className="button-row">
            <label>
              Follow-up status
              <select
                value={conversation.follow_up}
                disabled={busy}
                onChange={(e) => void change('follow_up', { status: e.target.value })}
              >
                <option value="none">No follow-up</option>
                <option value="required">Follow-up required</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void change('conversation_read', { unread: true })}
            >
              Mark unread
            </button>
          </div>
          {(conversation.partial_transcript || conversation.kind !== 'text') && (
            <p className="notice">
              Partially transcribed voice conversation. Only available text is shown. Missing speech
              and interrupted replies are not reconstructed. Raw microphone audio is not stored.
            </p>
          )}
          <div className="conversation-summary">
            <h3>AI summary</h3>
            {conversation.summary_status === 'ready' && conversation.summary ? (
              <>
                <p>{conversation.summary.overview}</p>
                {Object.entries(sections).map(([key, label]) => (
                  <section key={key}>
                    <h4>{label}</h4>
                    {(conversation.summary?.[key] as Point[] | undefined)?.length ? (
                      <ul>
                        {(conversation.summary![key] as Point[]).map((point, i) => (
                          <li key={i}>
                            {point.text}
                            <details>
                              <summary>Transcript evidence</summary>
                              {point.evidence.map((e, j) => (
                                <blockquote key={j}>
                                  <a
                                    href={`#transcript-${e.message_id}`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      document
                                        .getElementById(`transcript-${e.message_id}`)
                                        ?.scrollIntoView({ block: 'center' });
                                    }}
                                  >
                                    “{e.quote}”
                                  </a>
                                </blockquote>
                              ))}
                            </details>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No items recorded.</p>
                    )}
                  </section>
                ))}
              </>
            ) : (
              <>
                <p>
                  {conversation.status === 'active'
                    ? 'The conversation is in progress.'
                    : `Summary ${conversation.summary_status}. ${conversation.summary_error || 'The transcript is preserved while background processing completes.'}`}
                </p>
                {conversation.status === 'completed' &&
                  ['failed', 'pending'].includes(conversation.summary_status) && (
                    <button disabled={busy} onClick={() => void change('retry_summary')}>
                      Retry summary
                    </button>
                  )}
              </>
            )}
          </div>
          <details className="transcript-panel" open>
            <summary>
              Available transcript ({messages.length}
              {more ? '+' : ''} messages)
            </summary>
            {!messages.length ? (
              <p>No transcript was captured.</p>
            ) : (
              messages.map((m) => (
                <article
                  className={`transcript-message ${m.role}`}
                  key={m.id}
                  id={`transcript-${m.id}`}
                >
                  <div>
                    <strong>{m.role === 'user' ? author : 'VexBot'}</strong>
                    <small>
                      {portalTime(m.created_at, timezone)} · {m.medium}
                    </small>
                  </div>
                  <p>{m.content}</p>
                  {m.attachments?.length > 0 && (
                    <small>{m.attachments.length} attached file reference(s)</small>
                  )}
                  {[
                    ...(m.vexbot_citations || []).map(
                      (c) => c.vexbot_documents?.title || 'Removed document',
                    ),
                    ...(m.vexbot_file_citations || []).map((c) => c.file_name),
                  ].map((title, i) => (
                    <span className="pill" key={i}>
                      {title}
                    </span>
                  ))}
                </article>
              ))
            )}
            {more && (
              <button
                className="secondary"
                disabled={loading}
                onClick={() => void load(messages.length)}
              >
                {loading ? 'Loading…' : 'Load more transcript'}
              </button>
            )}
          </details>
        </>
      )}
    </section>
  );
}
