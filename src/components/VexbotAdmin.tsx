import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Eye, FileUp, History as HistoryIcon, KeyRound, RefreshCw, ShieldCheck, Sparkles, Upload, UserRound } from 'lucide-react';
import { api, db, unwrap } from '../services/portal';
import { UPLOAD_ACCEPT, UPLOAD_HINT, UPLOAD_STATUS, uploadPrivate, type UploadState } from '../vexbot/uploads';
import type { Client, Profile } from '../types/portal';

type Doc = { id: string; title: string; content: string; status: 'draft' | 'in_review' | 'published' | 'retired'; workspace_id: string | null; upload_id: string | null; updated_at: string; published_at: string | null; published_by: string | null };
type Settings = { version: number; business_profile: Record<string, string>; tone: string; detail: string; guidance: string; updated_at: string };
type Version = { version: number; snapshot: Omit<Settings, 'version' | 'updated_at'>; changed_by: string | null; changed_at: string; note: string | null };
type Audit = { id: number; actor: string; action: string; target: string | null; created_at: string };
type Tab = 'Knowledge' | 'Uploads' | 'Business profile' | 'Behaviour' | 'Preview' | 'History';

const TONES: Record<string, string> = { friendly: 'Friendly and approachable, in plain language.', professional: 'Professional, precise and businesslike.', concise: 'Direct and to the point.', warm: 'Warm and reassuring.' };
const DETAIL: Record<string, string> = { brief: 'One to three short sentences.', standard: 'A short paragraph.', detailed: 'Thorough, with steps where useful.' };
const FIELDS: [string, string, number, boolean?][] = [
  ['name', 'Business name', 120], ['summary', 'About the business', 1200, true], ['services', 'Services', 1200, true], ['audience', 'Who you work with', 400, true],
  ['hours', 'Support hours', 300], ['location', 'Location', 300], ['contact_email', 'Contact email', 254], ['contact_phone', 'Contact phone', 40], ['website', 'Website (https://)', 200],
];
const STATUS_LABEL: Record<Doc['status'], string> = { draft: 'Draft', in_review: 'In review', published: 'Published', retired: 'Retired' };

/** TOTP enrolment and verification. Vexbot changes need an AAL2 session; the server enforces it too. */
function MfaGate({ onVerified }: { onVerified: () => void }) {
  const [state, setState] = useState<'loading' | 'enroll' | 'verify'>('loading');
  const [factor, setFactor] = useState<{ id: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const factors = unwrap(await db().auth.mfa.listFactors());
      const verified = factors.totp.find((f) => f.status === 'verified');
      if (verified) { setFactor({ id: verified.id }); setState('verify'); return; }
      setState('enroll');
    })().catch((e) => setError((e as Error).message));
  }, []);
  async function enroll() {
    setBusy(true); setError('');
    try {
      const factors = unwrap(await db().auth.mfa.listFactors());
      for (const stale of factors.all.filter((f) => f.status !== 'verified')) await db().auth.mfa.unenroll({ factorId: stale.id });
      const data = unwrap(await db().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Vexora portal ${new Date().toISOString().slice(0, 16)}` }));
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true); setError('');
    try {
      unwrap(await db().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() }));
      setCode('');
      onVerified();
    } catch { setError('That code did not work. Check your authenticator app and try again.'); } finally { setBusy(false); }
  }
  return (
    <section className="panel vexbot-mfa" data-testid="vexbot-mfa">
      <div className="panel-heading"><div><h2><KeyRound size={18} /> Verify to make changes</h2><p>Knowledge and settings changes require multi-factor authentication. You can browse without it.</p></div></div>
      {state === 'enroll' && !factor?.qr && <button onClick={enroll} disabled={busy}>Set up an authenticator app</button>}
      {factor?.qr && (
        <div className="mfa-enroll">
          <img src={factor.qr} alt="QR code for your authenticator app" width={168} height={168} />
          <p>Scan the code with your authenticator app, or enter this key: <code data-testid="vexbot-mfa-secret">{factor.secret}</code></p>
        </div>
      )}
      {(state === 'verify' || factor?.qr) && (
        <form className="mfa-form" onSubmit={verify}>
          <label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} data-testid="vexbot-mfa-code" /></label>
          <button disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </form>
      )}
      {error && <p role="alert" className="notice error">{error}</p>}
    </section>
  );
}

export function VexbotAdmin({ clients, profiles }: { clients: Client[]; profiles: Profile[] }) {
  const [tab, setTab] = useState<Tab>('Knowledge');
  const [aal2, setAal2] = useState(false);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [filter, setFilter] = useState<Doc['status'] | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ outcome: string; content: string; citations: { document_id: string; title: string; excerpt: string }[]; uses_profile: boolean } | null>(null);
  const company = (id: string | null | undefined) => (id ? clients.find((c) => c.id === id)?.company ?? 'Unknown workspace' : 'All workspaces (business-wide)');
  const person = (id: string | null) => profiles.find((p) => p.id === id)?.display_name ?? 'Staff';

  const checkAal = useCallback(async () => {
    const level = unwrap(await db().auth.mfa.getAuthenticatorAssuranceLevel());
    setAal2(level.currentLevel === 'aal2');
  }, []);
  const load = useCallback(async () => {
    const [docs, ups, current, versions, events] = await Promise.all([
      db().from('vexbot_documents').select('*').order('updated_at', { ascending: false }).limit(500),
      db().from('vexbot_uploads').select('*').order('created_at', { ascending: false }).limit(200),
      db().from('vexbot_settings').select('*').eq('id', 1).single(),
      db().from('vexbot_settings_history').select('*').order('version', { ascending: false }).limit(50),
      db().from('vexbot_audit').select('*').order('created_at', { ascending: false }).limit(40),
    ]);
    setDocuments(unwrap(docs) as Doc[]);
    setUploads(unwrap(ups) as UploadState[]);
    const value = unwrap(current) as Settings;
    setSettings(value);
    setDraft((existing) => (existing && existing.version === value.version ? existing : value));
    setHistory(unwrap(versions) as Version[]);
    setAudit(unwrap(events) as Audit[]);
  }, []);
  useEffect(() => { void checkAal().catch(() => {}); void load().catch((e) => setError((e as Error).message)); }, [checkAal, load]);

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await work();
      if (done) setNotice(done);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function uploadKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form);
    const file = value.get('file') as File;
    const scope = String(value.get('scope') || '') || null;
    const title = String(value.get('title')).trim();
    await act(async () => {
      const upload = await uploadPrivate(file, 'knowledge', scope);
      if (upload.status !== 'clean') { setNotice(`${upload.name}: ${UPLOAD_STATUS[upload.status]}. It can become a document once it passes the malware scan.`); return; }
      const created = await api('vexbot', { action: 'document_create', upload_id: upload.id, workspace_id: scope, title });
      setSelected(created.document);
      setNotice(created.note || 'Draft created from the upload. Review the extracted text before submitting it.');
      form.reset();
    });
  }
  async function createText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form);
    await act(async () => {
      const created = await api('vexbot', { action: 'document_create', title: String(value.get('title')).trim(), workspace_id: String(value.get('scope') || '') || null, content: String(value.get('content')) });
      setSelected(created.document);
      form.reset();
    }, 'Draft created.');
  }
  const save = (doc: Doc) => act(async () => setSelected((await api('vexbot', { action: 'document_update', id: doc.id, title: doc.title, content: doc.content })).document), 'Draft saved.');
  const move = (doc: Doc, to: Doc['status']) => act(async () => setSelected((await api('vexbot', { action: 'document_status', id: doc.id, to })).document), to === 'published' ? 'Published. Vexbot can now cite it in its scope.' : to === 'retired' ? 'Retired. Vexbot no longer uses it, and earlier answers that cited it are withdrawn.' : `Moved to ${STATUS_LABEL[to].toLowerCase()}.`);
  const saveSettings = () => draft && act(() => api('vexbot', { action: 'settings_save', business_profile: draft.business_profile, tone: draft.tone, detail: draft.detail, guidance: draft.guidance }), 'Settings saved as a new version.');
  async function runPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget);
    if (!draft) return;
    await act(async () => setPreview(await api('vexbot', { action: 'preview', question: String(value.get('question')), workspace_id: String(value.get('scope') || '') || null, settings: { business_profile: draft.business_profile, tone: draft.tone, detail: draft.detail, guidance: draft.guidance } })));
  }

  const scopeSelect = (name = 'scope', fixed?: string | null) => (
    <label>Who it applies to
      <select name={name} defaultValue={fixed ?? ''} disabled={fixed !== undefined}>
        <option value="">All workspaces (business-wide)</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.company} only</option>)}
      </select>
    </label>
  );
  const locked = !aal2;
  const shown = documents.filter((d) => filter === 'all' || d.status === filter);
  const changed = draft && settings && JSON.stringify([draft.business_profile, draft.tone, draft.detail, draft.guidance]) !== JSON.stringify([settings.business_profile, settings.tone, settings.detail, settings.guidance]);

  return (
    <div className="vexbot-admin" data-testid="vexbot-admin">
      <div className="page-heading heading-row">
        <div>
          <div className="eyebrow">YOUR ASSISTANT, YOUR RULES</div>
          <h1>Vexbot<span className="purple-dot">.</span></h1>
          <p>Approve what Vexbot knows, how it speaks, and test it before clients do.</p>
        </div>
        <span className={`pill ${aal2 ? '' : 'muted'}`} data-testid="vexbot-aal">{aal2 ? <><ShieldCheck size={14} /> Verified for changes</> : 'View only until verified'}</span>
      </div>
      {!aal2 && <MfaGate onVerified={() => void checkAal().then(() => setNotice('Verified. You can now make Vexbot changes.'))} />}
      {error && <div role="alert" className="notice error">{error}</div>}
      {notice && <div role="status" className="notice">{notice}</div>}
      <div className="vexbot-tabs" role="tablist" aria-label="Vexbot settings">
        {(['Knowledge', 'Uploads', 'Business profile', 'Behaviour', 'Preview', 'History'] as Tab[]).map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>

      {tab === 'Knowledge' && (
        <div className="vexbot-admin-grid">
          <section className="panel">
            <div className="panel-heading"><div><h2>Documents <span className="count">{documents.length}</span></h2><p>Only published documents are used, and only within their scope.</p></div>
              <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="vexbot-doc-list">
              {shown.length === 0 ? <div className="empty compact"><BookOpen size={24} /><h3>No documents yet</h3><p>Upload a document or write one to give Vexbot approved knowledge.</p></div> : shown.map((doc) => (
                <button key={doc.id} className={`client-row ${selected?.id === doc.id ? 'selected' : ''}`} onClick={() => setSelected(doc)} data-testid="vexbot-doc">
                  <span className="row-copy"><strong>{doc.title}</strong><small>{company(doc.workspace_id)} · {new Date(doc.updated_at).toLocaleDateString()}</small></span>
                  <span className={`pill status-${doc.status}`}>{STATUS_LABEL[doc.status]}</span>
                </button>
              ))}
            </div>
            <details className="vexbot-new">
              <summary><FileUp size={16} /> Upload a document</summary>
              <form className="publish-form" onSubmit={uploadKnowledge}>
                <label>Title<input name="title" required maxLength={160} /></label>
                {scopeSelect()}
                <label>File<input name="file" type="file" required accept={UPLOAD_ACCEPT} data-testid="vexbot-knowledge-file" /></label>
                <p className="file-hint">{UPLOAD_HINT}. Files are privately stored, scanned for malware, and stay out of answers until published.</p>
                <button disabled={busy || locked}><Upload size={16} /> Upload and extract text</button>
              </form>
            </details>
            <details className="vexbot-new">
              <summary><Sparkles size={16} /> Write a document</summary>
              <form className="publish-form" onSubmit={createText}>
                <label>Title<input name="title" required maxLength={160} /></label>
                {scopeSelect()}
                <label>Text<textarea name="content" rows={6} maxLength={200000} required /></label>
                <button disabled={busy || locked}>Create draft</button>
              </form>
            </details>
          </section>
          <section className="panel" data-testid="vexbot-editor">
            {!selected ? <div className="empty"><BookOpen size={28} /><h3>Review a document</h3><p>Select a document to review its text, publish it or retire it.</p></div> : (() => {
              const editable = selected.status === 'draft' || selected.status === 'in_review';
              return (
                <>
                  <div className="panel-heading"><div><h2>{STATUS_LABEL[selected.status]}</h2><p>{company(selected.workspace_id)}{selected.upload_id ? ` · from ${uploads.find((u) => u.id === selected.upload_id)?.name ?? 'an upload'}` : ''}{selected.published_at ? ` · published ${new Date(selected.published_at).toLocaleString()} by ${person(selected.published_by)}` : ''}</p></div></div>
                  <form className="publish-form" onSubmit={(e) => { e.preventDefault(); void save(selected); }}>
                    <label>Title<input value={selected.title} maxLength={160} readOnly={!editable || locked} onChange={(e) => setSelected({ ...selected, title: e.target.value })} /></label>
                    <label>Reviewed text<textarea value={selected.content} rows={14} maxLength={200000} readOnly={!editable || locked} onChange={(e) => setSelected({ ...selected, content: e.target.value })} data-testid="vexbot-doc-content" /></label>
                    <p className="file-hint">Treat uploaded text as untrusted: remove anything that is not approved information, including instructions aimed at the assistant.</p>
                    <div className="button-row">
                      {editable && <button className="secondary" disabled={busy || locked}>Save</button>}
                      {selected.status === 'draft' && <button type="button" disabled={busy || locked || !selected.content.trim()} onClick={() => void move(selected, 'in_review')}>Submit for review</button>}
                      {selected.status === 'in_review' && <><button type="button" className="secondary" disabled={busy || locked} onClick={() => void move(selected, 'draft')}>Return to draft</button><button type="button" disabled={busy || locked} onClick={() => void move(selected, 'published')} data-testid="vexbot-publish">Publish</button></>}
                      {selected.status === 'published' && <button type="button" disabled={busy || locked} onClick={() => void move(selected, 'retired')} data-testid="vexbot-retire">Retire</button>}
                      {selected.status === 'retired' && <button type="button" className="secondary" disabled={busy || locked} onClick={() => void move(selected, 'draft')}>Return to draft</button>}
                    </div>
                  </form>
                </>
              );
            })()}
          </section>
        </div>
      )}

      {tab === 'Uploads' && (
        <section className="panel">
          <div className="panel-heading"><div><h2>Uploads <span className="count">{uploads.length}</span></h2><p>Client files and knowledge uploads. Nothing here is used by Vexbot until it becomes a published document.</p></div>
            <button className="secondary" onClick={() => void act(load)}><RefreshCw size={15} /> Refresh</button></div>
          <div className="files-list">
            {uploads.length === 0 ? <div className="empty compact"><Upload size={24} /><h3>No uploads yet</h3></div> : uploads.map((u) => (
              <div className="file-row" key={u.id} data-testid="vexbot-upload-row">
                <div className="row-copy"><strong>{u.name}</strong><small>{company(u.workspace_id)} · {u.purpose} · {UPLOAD_STATUS[u.status]}{u.status_detail ? ` · ${u.status_detail}` : ''}</small></div>
                {['quarantined', 'scan_failed'].includes(u.status) && <button className="secondary" disabled={busy} onClick={() => void act(() => api('vexbot', { action: 'upload_rescan', upload_id: u.id }), 'Scan finished.')}>Rescan</button>}
                {u.status === 'clean' && <button className="secondary" disabled={busy} onClick={() => void act(async () => window.open((await api('vexbot', { action: 'upload_url', upload_id: u.id })).url, '_blank', 'noopener'))}>Open</button>}
                {u.status === 'clean' && !documents.some((d) => d.upload_id === u.id) && <button disabled={busy || locked} onClick={() => void act(async () => { const created = await api('vexbot', { action: 'document_create', upload_id: u.id, workspace_id: u.workspace_id ?? null, title: u.name.replace(/\.[^.]+$/, '') }); setSelected(created.document); setTab('Knowledge'); }, 'Draft created. Review the text before publishing.')}>Make document</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(tab === 'Business profile' || tab === 'Behaviour') && draft && (
        <section className="panel">
          {tab === 'Business profile' ? (
            <>
              <div className="panel-heading"><div><h2><UserRound size={18} /> Business profile</h2><p>Approved facts Vexbot may use in every workspace, cited as the business profile.</p></div></div>
              <div className="vexbot-fields">
                {FIELDS.map(([key, label, max, long]) => (
                  <label key={key}>{label}
                    {long ? <textarea rows={3} maxLength={max} value={draft.business_profile[key] ?? ''} readOnly={locked} onChange={(e) => setDraft({ ...draft, business_profile: { ...draft.business_profile, [key]: e.target.value } })} />
                      : <input maxLength={max} value={draft.business_profile[key] ?? ''} readOnly={locked} onChange={(e) => setDraft({ ...draft, business_profile: { ...draft.business_profile, [key]: e.target.value } })} data-testid={`vexbot-profile-${key}`} />}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading"><div><h2>Behaviour</h2><p>Presets shape tone and length. Guidance adds house rules; it cannot override grounding or access rules.</p></div></div>
              <fieldset className="vexbot-presets"><legend>Tone</legend>
                {Object.entries(TONES).map(([key, text]) => <label key={key} className={draft.tone === key ? 'chosen' : ''}><input type="radio" name="tone" checked={draft.tone === key} disabled={locked} onChange={() => setDraft({ ...draft, tone: key })} /><strong>{key[0].toUpperCase() + key.slice(1)}</strong><small>{text}</small></label>)}
              </fieldset>
              <fieldset className="vexbot-presets"><legend>Answer detail</legend>
                {Object.entries(DETAIL).map(([key, text]) => <label key={key} className={draft.detail === key ? 'chosen' : ''}><input type="radio" name="detail" checked={draft.detail === key} disabled={locked} onChange={() => setDraft({ ...draft, detail: key })} /><strong>{key[0].toUpperCase() + key.slice(1)}</strong><small>{text}</small></label>)}
              </fieldset>
              <label className="vexbot-guidance">Behaviour guidance<textarea rows={5} maxLength={4000} value={draft.guidance} readOnly={locked} onChange={(e) => setDraft({ ...draft, guidance: e.target.value })} placeholder="For example: Use New Zealand English. Suggest Messages for anything about invoices." /></label>
            </>
          )}
          <div className="button-row">
            <button className="secondary" disabled={!changed || busy} onClick={() => setDraft(settings)}>Discard changes</button>
            <button disabled={!changed || busy || locked} onClick={() => void saveSettings()} data-testid="vexbot-save-settings">Save as version {settings ? settings.version + 1 : ''}</button>
          </div>
        </section>
      )}

      {tab === 'Preview' && draft && (
        <section className="panel">
          <div className="panel-heading"><div><h2><Eye size={18} /> Preview</h2><p>Ask as a client would, using the unsaved profile and behaviour. Nothing is stored.</p></div></div>
          <form className="publish-form" onSubmit={runPreview}>
            {scopeSelect()}
            <label>Question<input name="question" required maxLength={2000} data-testid="vexbot-preview-question" /></label>
            <button disabled={busy}>Preview answer</button>
          </form>
          {preview && (
            <article className="announcement" data-testid="vexbot-preview-answer">
              <div className="eyebrow">{preview.outcome === 'answered' ? 'GROUNDED ANSWER' : preview.outcome === 'no_answer' ? 'NOT IN APPROVED SOURCES' : 'UNAVAILABLE'}</div>
              <p>{preview.content}</p>
              {(preview.citations.length > 0 || preview.uses_profile) && <p className="file-hint">Sources: {[...preview.citations.map((c) => c.title), ...(preview.uses_profile ? ['Business profile'] : [])].join(' · ')}</p>}
            </article>
          )}
        </section>
      )}

      {tab === 'History' && (
        <div className="vexbot-admin-grid">
          <section className="panel">
            <div className="panel-heading"><div><h2><HistoryIcon size={18} /> Settings history</h2><p>Every saved version, with who changed it. Restoring creates a new version.</p></div></div>
            {history.map((row) => (
              <div className="file-row" key={row.version}>
                <div className="row-copy"><strong>Version {row.version}{settings?.version === row.version ? ' · current' : ''}</strong><small>{new Date(row.changed_at).toLocaleString()} · {row.changed_by ? person(row.changed_by) : 'Initial defaults'}{row.note ? ` · ${row.note}` : ''} · {row.snapshot.tone}, {row.snapshot.detail}</small></div>
                {settings?.version !== row.version && <button className="secondary" disabled={busy || locked} onClick={() => void act(() => api('vexbot', { action: 'settings_restore', version: row.version }), `Restored version ${row.version}.`)}>Restore</button>}
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Recent changes</h2><p>Knowledge and upload actions.</p></div></div>
            {audit.map((row) => <div className="file-row" key={row.id}><div className="row-copy"><strong>{row.action}</strong><small>{person(row.actor)} · {new Date(row.created_at).toLocaleString()}{row.target ? ` · ${documents.find((d) => d.id === row.target)?.title ?? uploads.find((u) => u.id === row.target)?.name ?? ''}` : ''}</small></div></div>)}
          </section>
        </div>
      )}
    </div>
  );
}
