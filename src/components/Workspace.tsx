import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  FileText,
  FolderOpen,
  MessageSquare,
  Play,
  Plus,
  Settings2,
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

export function Workspace({
  client,
  profile,
  data,
  refresh,
  onManage,
  onMessages,
  onBack,
}: {
  client: Client;
  profile: Profile;
  data: PortalData;
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
  const [video, setVideo] = useState<{ url: string; name: string } | null>(null);
  const videoDialog = useRef<HTMLDialogElement>(null);
  const [removing, setRemoving] = useState<PortalFile | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const files = data.files.filter((row) => row.workspace_id === client.id);
  const announcements = data.announcements.filter((row) => row.workspace_id === client.id);
  const conversations = data.conversations.filter((row) => row.workspace_id === client.id);
  const unreadCount = conversations.reduce((sum, row) => sum + unread(row.id, data, profile.id), 0);
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
  async function openFile(file: PortalFile, download = false) {
    setError('');
    try {
      if (file.mime_type.startsWith('video/') && !download) {
        setVideo({ url: await fileUrl(file), name: file.name });
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
        <section className="panel files-panel">
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
              PDF, Office, images, text, MP4 or WebM · up to 50 MB per file
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
              {files.map((file) => (
                <div className="file-row" key={file.id}>
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
                </div>
              ))}
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
        {publishing && (
          <form className="publish-form" onSubmit={publish}>
            <label>
              Update title
              <input name="title" required maxLength={160} />
            </label>
            <label>
              Message
              <textarea name="body" required maxLength={10000} rows={5} />
            </label>
            <button disabled={busy}>Publish to client</button>
          </form>
        )}
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
      <dialog className="video-dialog" ref={videoDialog} onClose={() => setVideo(null)}>
        <div className="panel-heading">
          <h2>{video?.name}</h2>
          <button
            className="icon-button"
            aria-label="Close video"
            onClick={() => videoDialog.current?.close()}
          >
            <X size={21} />
          </button>
        </div>
        {video && (
          <video
            src={video.url}
            controls
            autoPlay
            onError={() => setError('Video playback failed. Try downloading the video instead.')}
          >
            Your browser does not support this video. Please download it.
          </video>
        )}
        <p>Playback links expire after one hour. Reopen the video to refresh.</p>
      </dialog>
      <dialog ref={removeDialog} onCancel={() => setRemoving(null)}>
        <h2>Remove shared file?</h2>
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
