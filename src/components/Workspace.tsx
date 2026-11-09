import { ASK_EVENT } from '../vexbot/Vexbot';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, LayoutGroup, m, useReducedMotion } from 'motion/react';
import { motionTokens } from '../design/motion-tokens';
import {
  UPLOAD_ACCEPT,
  UPLOAD_HINT,
  UPLOAD_STATUS,
  uploadPrivate,
  type UploadState,
} from '../vexbot/uploads';
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  FileText,
  FolderOpen,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  allowedTypes,
  db,
  fileUrl,
  removeFile,
  unread,
  unwrap,
  uploadFile,
} from '../services/portal';
import type { Client, PortalData, PortalFile, Profile } from '../types/portal';

const ClientVideo = lazy(() => import('./video/client-video'));
const VideoChapterEditor = lazy(() => import('./video/video-chapter-editor'));

// Shared files Vexbot can read the text of (the same types server/vexbot/files.mjs extracts).
const READABLE = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export function Workspace({
  client,
  profile,
  data,
  readOnly = false,
  refresh,
  onManage,
  onMessages,
  onBack,
}: {
  client: Client;
  profile: Profile;
  data: PortalData;
  readOnly?: boolean;
  refresh: () => Promise<void>;
  onManage: () => void;
  onMessages: () => void;
  onBack?: () => void;
}) {
  const admin = profile.role === 'admin';
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [video, setVideo] = useState<{ url: string; file: PortalFile; edit: boolean } | null>(null);
  const videoDialog = useRef<HTMLDialogElement>(null);
  const [removing, setRemoving] = useState<PortalFile | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const files = data.files.filter((row) => row.workspace_id === client.id);
  const announcements = data.announcements.filter((row) => row.workspace_id === client.id);
  const conversations = data.conversations.filter((row) => row.workspace_id === client.id);
  const unreadCount = conversations.reduce((sum, row) => sum + unread(row.id, data, profile.id), 0);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [sending, setSending] = useState(false);
  const [category, setCategory] = useState('All files');
  const reduced = useReducedMotion();
  const visibleFiles = files.filter(
    (file) =>
      category === 'All files' ||
      (category === 'Videos'
        ? file.mime_type.startsWith('video/')
        : !file.mime_type.startsWith('video/')),
  );
  const loadUploads = useCallback(async () => {
    setUploads(
      unwrap(
        await db()
          .from('vexbot_uploads')
          .select('id,name,status,status_detail,purpose,created_at')
          .eq('workspace_id', client.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ) as UploadState[],
    );
  }, [client.id]);
  useEffect(() => {
    void loadUploads().catch(() => {});
  }, [loadUploads]);
  // Private client uploads: quarantined, scanned, and only used by Vexbot after staff review.
  async function sendPrivate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadPrivate(file, 'workspace', client.id);
      setNotice(`${result.name}: ${UPLOAD_STATUS[result.status]}.`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSending(false);
      await loadUploads().catch(() => {});
    }
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await uploadFile(client.id, file);
      setNotice('File shared with this client.');
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form);
    setBusy(true);
    setError('');
    try {
      unwrap(
        await db()
          .from('portal_announcements')
          .insert({
            workspace_id: client.id,
            title: String(value.get('title')).trim(),
            body: String(value.get('body')).trim(),
            author_id: profile.id,
          }),
      );
      form.reset();
      setPublishing(false);
      setNotice('Update published.');
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openFile(file: PortalFile, download = false, edit = false) {
    setError('');
    try {
      if (file.mime_type.startsWith('video/') && !download) {
        setVideo({ url: await fileUrl(file), file, edit });
        videoDialog.current?.showModal();
      } else {
        // Download a private object into memory; no expiring URLs remain in browser history.
        const blob = unwrap(await db().storage.from('portal-private').download(file.path));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function deleteFile() {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await removeFile(removing);
      removeDialog.current?.close();
      setRemoving(null);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {onBack && (
        <button className="text-button back-button" onClick={onBack}>
          <ArrowLeft size={15} />
          All clients
        </button>
      )}
      <div className="page-heading heading-row">
        <div>
          <div className="eyebrow">
            {admin ? 'PRIVATE CLIENT WORKSPACE' : 'YOUR PRIVATE WORKSPACE'}
          </div>
          <h1>
            {client.company}
            <span className="purple-dot">.</span>
          </h1>
          <p>
            {admin ? client.email : 'Your shared work, latest updates and a direct line to Vexora.'}
          </p>
        </div>
        {admin && (
          <button className="secondary" onClick={onManage}>
            <Settings2 size={17} />
            Manage client
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      <div className="workspace-grid">
        <section className="panel files-panel" aria-busy={busy}>
          <div className="panel-heading">
            <div>
              <h2>
                Shared files <span className="count">{files.length}</span>
              </h2>
              <p>Documents and videos, in the right hands.</p>
            </div>
            {admin && (
              <label className={`upload-button ${busy ? 'disabled' : ''}`}>
                <Upload size={16} />
                {busy ? 'Uploading…' : 'Upload file'}
                <input
                  type="file"
                  aria-label="Upload client file"
                  accept={allowedTypes.join(',')}
                  disabled={busy}
                  onChange={upload}
                />
              </label>
            )}
          </div>
          {admin && (
            <p className="file-hint">
              MP4 up to 100 MB · PDF, Office, images, text and WebM up to 50 MB
            </p>
          )}
          <LayoutGroup id="file-categories">
            <div className="tabs file-tabs" aria-label="File categories">
              {['All files', 'Documents', 'Videos'].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={category === item ? 'selected' : ''}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {category === item && (
                    <m.span
                      className="tab-indicator"
                      layoutId="file-category"
                      aria-hidden="true"
                      transition={reduced ? { duration: 0 } : motionTokens.spring}
                    />
                  )}
                  {item}
                </button>
              ))}
            </div>
          </LayoutGroup>
          {busy && (
            <p className="file-hint" role="status">
              Updating your workspace…
            </p>
          )}
          {files.length === 0 ? (
            <div className="empty">
              <FolderOpen size={30} />
              <h3>A home for your shared work</h3>
              <p>
                {admin
                  ? 'Upload a document or video to make it available to this client.'
                  : 'Documents and videos shared by Vexora will appear here.'}
              </p>
            </div>
          ) : (
            <div className="files-list">
              {visibleFiles.length === 0 && (
                <div className="empty compact">
                  <FolderOpen size={24} />
                  <p>No {category.toLowerCase()} shared yet.</p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {visibleFiles.map((file) => (
                  <m.div
                    className="file-row"
                    key={file.id}
                    initial={reduced ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : motionTokens.micro }}
                  >
                    <span className="file-icon">
                      {file.mime_type.startsWith('video/') ? (
                        <Play size={21} />
                      ) : (
                        <FileText size={21} />
                      )}
                    </span>
                    <div className="row-copy">
                      <strong>{file.name}</strong>
                      <small>
                        {(file.size_bytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                        {new Date(file.created_at).toLocaleDateString()}
                      </small>
                    </div>
                    {file.mime_type.startsWith('video/') && (
                      <button
                        className="icon-button"
                        aria-label={`Play ${file.name}`}
                        onClick={() => openFile(file)}
                      >
                        <Play size={17} />
                      </button>
                    )}
                    {admin && ['video/mp4', 'video/webm'].includes(file.mime_type) && (
                      <button type="button" className="secondary" onClick={() => openFile(file, false, true)}
                        aria-label={`Manage video chapters for ${file.name}`}>Manage video chapters</button>
                    )}
                    {READABLE.has(file.mime_type) && (
                      <button
                        className="icon-button"
                        aria-label={`Ask Vexbot about ${file.name}`}
                        title="Ask Vexbot about this file"
                        data-testid="workspace-ask-vexbot"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent(ASK_EVENT, {
                              detail: {
                                workspace: client.id,
                                question: `Summarize “${file.name}”`,
                              },
                            }),
                          )
                        }
                      >
                        <MessageCircle size={17} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`Download ${file.name}`}
                      onClick={() => openFile(file, true)}
                    >
                      <Download size={17} />
                    </button>
                    {admin && (
                      <button
                        className="icon-button"
                        aria-label={`Remove ${file.name}`}
                        disabled={busy}
                        onClick={() => {
                          setRemoving(file);
                          removeDialog.current?.showModal();
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
        <section className="conversation-callout">
          <span className="stat-icon">
            <MessageSquare size={25} />
          </span>
          <h2>Let’s keep things moving.</h2>
          <p>
            Have a question or an idea?
            <br />
            Your conversation starts here.
          </p>
          {unreadCount > 0 && (
            <span className="pill">
              {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
            </span>
          )}
          <button onClick={onMessages}>
            Open messages
            <ArrowUpRight size={17} />
          </button>
        </section>
      </div>
      <section className="panel updates-panel" data-testid="workspace-uploads" aria-busy={sending}>
        <div className="panel-heading">
          <div>
            <h2>
              {admin ? 'Client uploads' : 'Send files to Vexora'}{' '}
              <span className="count">{uploads.length}</span>
            </h2>
            <p>
              Private to this workspace. Every file is scanned for malware and reviewed by the team
              before Vexbot can use it.
            </p>
          </div>
          {!admin && !readOnly && (
            <label className={`upload-button ${sending ? 'disabled' : ''}`}>
              <ShieldCheck size={16} />
              {sending ? 'Uploading…' : 'Upload privately'}
              <input
                type="file"
                aria-label="Upload a private file for Vexora"
                accept={UPLOAD_ACCEPT}
                disabled={sending}
                onChange={sendPrivate}
                data-testid="workspace-private-upload"
              />
            </label>
          )}
        </div>
        {!admin && !readOnly && <p className="file-hint">{UPLOAD_HINT}</p>}
        {readOnly && (
          <p className="file-hint">Your access is read-only, so uploads are turned off.</p>
        )}
        {uploads.length === 0 ? (
          <div className="empty compact">
            <ShieldCheck size={24} />
            <p>No private uploads yet.</p>
          </div>
        ) : (
          <div className="files-list">
            {uploads.map((row) => (
              <div className="file-row" key={row.id} data-status={row.status}>
                <span className="file-icon">
                  <FileText size={21} />
                </span>
                <div className="row-copy">
                  <strong>{row.name}</strong>
                  <small>
                    {UPLOAD_STATUS[row.status]}
                    {row.created_at ? ` · ${new Date(row.created_at).toLocaleDateString()}` : ''}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel updates-panel">
        <div className="panel-heading">
          <div>
            <h2>Latest updates</h2>
            <p>A note from Vexora, just for this workspace.</p>
          </div>
          {admin && (
            <button className="secondary" onClick={() => setPublishing(!publishing)}>
              <Plus size={16} />
              {publishing ? 'Cancel' : 'Publish update'}
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {publishing && (
            <m.form
              className="publish-form"
              onSubmit={publish}
              initial={reduced ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : motionTokens.component }}
            >
              <label>
                Update title
                <input name="title" required maxLength={160} />
              </label>
              <label>
                Message
                <textarea name="body" required maxLength={10000} rows={5} />
              </label>
              <button disabled={busy}>Publish to client</button>
            </m.form>
          )}
        </AnimatePresence>
        {announcements.length === 0 ? (
          <div className="empty compact">
            <MessageSquare size={26} />
            <h3>Space for what’s next</h3>
            <p>
              {admin
                ? 'Publish an update to keep this client in the loop.'
                : 'Your latest updates from Vexora will appear here.'}
            </p>
          </div>
        ) : (
          announcements.map((row) => (
            <article className="announcement" key={row.id}>
              <div className="eyebrow">
                VEXORA UPDATE <span>· {new Date(row.created_at).toLocaleDateString()}</span>
              </div>
              <h3>{row.title}</h3>
              <p>{row.body}</p>
            </article>
          ))
        )}
      </section>
      <dialog
        className="video-dialog"
        ref={videoDialog}
        aria-labelledby="video-title"
        onClose={() => setVideo(null)}
      >
        <div className="panel-heading">
          <h2 id="video-title">{video?.edit ? 'Manage video chapters' : video?.file.name}</h2>
          <button
            className="icon-button"
            aria-label="Close video"
            onClick={() => videoDialog.current?.close()}
          >
            <X size={21} />
          </button>
        </div>
        {video && (
          <Suspense fallback={<p role="status">Opening video…</p>}>
            {video.edit
              ? <VideoChapterEditor file={video.file} url={video.url} onClose={() => videoDialog.current?.close()} />
              : <ClientVideo file={video.file} url={video.url} />}
          </Suspense>
        )}
        <p>Playback links expire after one hour. Reopen the video to refresh.</p>
      </dialog>
      <dialog
        ref={removeDialog}
        aria-labelledby="remove-file-title"
        onCancel={() => setRemoving(null)}
      >
        <h2 id="remove-file-title">Remove shared file?</h2>
        <p>“{removing?.name}” will be removed from this workspace and private storage.</p>
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              removeDialog.current?.close();
              setRemoving(null);
            }}
          >
            Cancel
          </button>
          <button disabled={busy} onClick={deleteFile}>
            {busy ? 'Removing…' : 'Remove file'}
          </button>
        </div>
      </dialog>
    </>
  );
}
