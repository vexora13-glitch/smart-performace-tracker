import { useEffect, useRef, useState } from "react";
import { chapterError, formatVideoTime, MAX_CHAPTERS, MAX_THUMBNAIL_BYTES, parseVideoTime, THUMBNAIL_WIDTH, type Chapter } from "./video-chapters";
import { ChapterPlayer, ChapterThumbnail, type Playback } from "./chapter-player";
import styles from "./video.module.css";
import type { PortalFile } from "../../types/portal";
import { fileUrl, loadChapters, saveChapters, uploadChapterThumbnail } from "./video-service";

type Snapshot = Playback & { revision: number; publishedRevision: number };
type EditChapter = Omit<Chapter, "start" | "end"> & { start: string; end: string; image?: Blob };

function parseChapter(chapter: EditChapter): Chapter {
  return {
    id: chapter.id, title: chapter.title, description: chapter.description,
    thumbnailPath: chapter.thumbnailPath, thumbnailUrl: chapter.thumbnailUrl,
    start: parseVideoTime(chapter.start), end: chapter.end.trim() ? parseVideoTime(chapter.end) : null,
  };
}

async function makeThumbnail(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, THUMBNAIL_WIDTH / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!image || image.size > MAX_THUMBNAIL_BYTES) throw new Error("Could not prepare this thumbnail.");
  return { image, thumbnailPath: null, thumbnailUrl: canvas.toDataURL("image/jpeg", 0.78) };
}

export default function VideoChapterEditor({ file, url, onClose }: { file: PortalFile; url: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [load, setLoad] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await loadChapters(file, true, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ ...data, url, title: file.name });
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not open the editor.");
      }
    })();
    return () => controller.abort();
  }, [file, url, load]);

  if (snapshot) return <Editor file={file} snapshot={snapshot} onClose={onClose} />;
  return <section className={styles.editor}>
    <button type="button" onClick={onClose}>Close editor</button>
    {error ? <><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setLoad(n => n + 1); }}>Try again</button></>
      : <p role="status">Opening chapter editor…</p>}
  </section>;
}

function Editor({ file, snapshot, onClose }: { file: PortalFile; snapshot: Snapshot; onClose: () => void }) {
  const [rows, setRows] = useState<EditChapter[]>(() => snapshot.chapters.map(c => ({ ...c, start: String(c.start), end: c.end === null ? "" : String(c.end) })));
  const [revision, setRevision] = useState(snapshot.revision);
  const [publishedRevision, setPublishedRevision] = useState(snapshot.publishedRevision);
  const [source, setSource] = useState({ url: snapshot.url, key: 0, resumeAt: 0 });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const preview = rows.map(parseChapter).filter(chapter => Number.isFinite(chapter.start) && chapter.start >= 0)
    .map(chapter => ({ ...chapter, title: chapter.title.trim() || "Untitled chapter" }));

  useEffect(() => { heading.current?.focus(); }, []);

  function update(chapterId: string, values: Partial<EditChapter>) {
    setRows(previous => previous.map(row => row.id === chapterId ? { ...row, ...values } : row));
    setDirty(true);
  }

  function timestamp() {
    const media = video.current;
    if (!media || media.readyState < 1 || !Number.isFinite(media.duration)) {
      setError("Wait for the video to load before taking its timestamp.");
      return null;
    }
    return String(Math.min(Math.floor(media.currentTime * 1000) / 1000, Math.max(0, Math.ceil(media.duration * 1000 - 1) / 1000)));
  }

  function add(atPlayback: boolean) {
    const start = atPlayback ? timestamp() : "";
    if (start === null) return;
    setRows(previous => [...previous, { id: crypto.randomUUID(), title: "", description: "", start, end: "", thumbnailPath: null }]);
    setDirty(true);
    setError("");
    setStatus("Chapter added.");
  }

  function move(index: number, change: number) {
    const reordered = [...rows];
    const [row] = reordered.splice(index, 1);
    reordered.splice(index + change, 0, row);
    setRows(reordered);
    setDirty(true);
    setStatus(`Moved ${row.title || "chapter"} to position ${index + change + 1}.`);
  }

  async function setThumbnail(chapterId: string, file?: File) {
    setError("");
    setBusy(true);
    try {
      if (file) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
          throw new Error("Choose a JPEG, PNG or WebP image up to 10 MB.");
        }
        const bitmap = await createImageBitmap(file);
        try { update(chapterId, await makeThumbnail(bitmap, bitmap.width, bitmap.height)); }
        finally { bitmap.close(); }
      } else {
        const media = video.current;
        if (!media || media.readyState < 2 || media.seeking || !media.videoWidth) {
          throw new Error("Pause on a loaded frame, then try capturing again.");
        }
        update(chapterId, await makeThumbnail(media, media.videoWidth, media.videoHeight));
      }
      setStatus("Thumbnail ready to save.");
    } catch (problem) {
      setError(problem instanceof DOMException && problem.name === "SecurityError"
        ? "The video host blocked frame capture. Upload a thumbnail instead."
        : problem instanceof Error ? problem.message : "Could not prepare the thumbnail.");
    } finally { setBusy(false); }
  }

  async function send(publish: boolean) {
    setError("");
    setStatus("");
    const duration = video.current && Number.isFinite(video.current.duration) && video.current.duration > 0 ? video.current.duration : null;
    const issue = chapterError(rows.map(parseChapter), duration);
    if (issue) { setError(issue); return; }
    setBusy(true);
    try {
      const saved: EditChapter[] = [];
      for (let i = 0; i < rows.length; i += 4) {
        const batch = await Promise.all(rows.slice(i, i + 4).map(async row => {
          if (!row.image) return row;
          const data = await uploadChapterThumbnail(file, row.image);
          return { ...row, image: undefined, thumbnailPath: data.path, thumbnailUrl: data.url };
        }));
        saved.push(...batch);
      }
      const next = await saveChapters(file, saved.map(parseChapter), revision, publish, duration);
      setRows(saved);
      setRevision(next);
      if (publish) setPublishedRevision(next);
      setDirty(false);
      setStatus(publish ? "Chapters published to this workspace." : "Draft saved. Client chapters are unchanged.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save chapters.");
    } finally { setBusy(false); }
  }

  async function reloadVideo(seconds: number) {
    setError("");
    try {
      const url = await fileUrl(file);
      setSource(previous => ({ url, key: previous.key + 1, resumeAt: seconds }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not reload the video.");
    }
  }

  return <section className={styles.editor} aria-labelledby="chapter-editor-heading">
    <div className={styles.editorHeading}>
      <div>
        <span className={styles.meta}>VIDEO CHAPTER EDITOR</span>
        <h2 id="chapter-editor-heading" ref={heading} tabIndex={-1}>{snapshot.title}</h2>
      </div>
      <button type="button" disabled={busy} onClick={() => {
        if (!dirty || window.confirm("Close the editor and discard unsaved chapter changes?")) onClose();
      }}>Close editor</button>
    </div>
    <h3>Client preview</h3>
    <ChapterPlayer key={source.key} playback={{ url: source.url, title: snapshot.title, chapters: preview }}
      videoRef={video} onRetry={reloadVideo} resumeAt={source.resumeAt} />
    <div className={styles.editorHeading}>
      <h3>Edit chapters</h3>
      <span className={styles.meta}>{dirty ? "Unsaved changes" : revision > publishedRevision ? "Draft saved" : publishedRevision ? "Published" : "No saved chapters"}</span>
    </div>
    <p>Choose an order for the chapter list. Timeline markers stay at their timestamps. Use seconds or M:SS, with optional milliseconds.</p>
    <fieldset disabled={busy} className={styles.fields}>
      <legend className={styles.srOnly}>Chapter fields</legend>
      <div className={styles.actions}>
        <button type="button" disabled={rows.length >= MAX_CHAPTERS} onClick={() => add(true)}>Add chapter at current time</button>
        <button type="button" disabled={rows.length >= MAX_CHAPTERS} onClick={() => add(false)}>Add chapter manually</button>
      </div>
      {!rows.length && <p>No chapters in this draft. Publishing an empty list clears client chapters.</p>}
      {rows.map((row, index) => <fieldset className={styles.editRow} key={row.id}>
        <legend>Chapter {index + 1}{row.title ? ` · ${row.title}` : ""}</legend>
        <div className={styles.editFields}>
          <label>Title<input value={row.title} maxLength={120} onChange={event => update(row.id, { title: event.target.value })} /></label>
          <label>Description (optional)<input value={row.description} maxLength={600} onChange={event => update(row.id, { description: event.target.value })} /></label>
          <label>Start time<input value={row.start} maxLength={12} placeholder="0:00" onChange={event => update(row.id, { start: event.target.value })} /></label>
          <label>End time (optional)<input value={row.end} maxLength={12} placeholder="Until the next chapter" onChange={event => update(row.id, { end: event.target.value })} /></label>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { const start = timestamp(); if (start !== null) { update(row.id, { start }); setError(""); setStatus(`Start set to ${formatVideoTime(Number(start))}.`); } }}>Use current time</button>
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" onClick={() => { setRows(previous => previous.filter(c => c.id !== row.id)); setDirty(true); setStatus("Chapter removed from draft."); }}>Delete chapter</button>
        </div>
        <div className={styles.thumbnailTools}>
          <ChapterThumbnail url={row.thumbnailUrl} />
          <button type="button" onClick={() => void setThumbnail(row.id)}>Capture current frame</button>
          <label>Upload thumbnail<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void setThumbnail(row.id, file);
          }} /></label>
          {(row.thumbnailPath || row.image) && <button type="button" onClick={() => update(row.id, { image: undefined, thumbnailPath: null, thumbnailUrl: undefined })}>Remove thumbnail</button>}
        </div>
      </fieldset>)}
      <div className={styles.actions}>
        <button type="button" disabled={!dirty} onClick={() => void send(false)}>Save draft</button>
        <button type="button" className={styles.publish} disabled={!dirty && revision === publishedRevision} onClick={() => void send(true)}>Publish chapters</button>
      </div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <p role="status">{busy ? "Working…" : status}</p>
  </section>;
}
