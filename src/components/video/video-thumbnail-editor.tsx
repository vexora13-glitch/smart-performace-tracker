import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ImageUp, Pause, Play, RotateCcw } from 'lucide-react';
import { fileUrl } from '../../services/portal';
import type { PortalFile, VideoThumbnail } from '../../types/portal';
import { formatVideoTime } from './video-chapters';
import type { ThumbnailView } from './use-video-thumbnails';
import {
  canvasToJpeg,
  clampCrop,
  cropLimits,
  drawThumbnail,
  MAX_SOURCE_IMAGE_BYTES,
  saveThumbnail,
  type Crop,
} from './video-thumbnails';

type Tab = 'frame' | 'upload';
const FRAME = 1 / 30;
const message = (problem: unknown, fallback: string) =>
  problem instanceof DOMException && problem.name === 'SecurityError'
    ? 'The video host blocked frame capture. Upload an image instead.'
    : problem instanceof Error
      ? problem.message
      : fallback;

export default function VideoThumbnailEditor({
  file,
  view,
  available = true,
  onSaved,
  onRegenerate,
  onClose,
}: {
  file: PortalFile;
  view: ThumbnailView;
  /** False when the database has no thumbnails table yet (migration not applied). */
  available?: boolean;
  onSaved: (row: VideoThumbnail) => void;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('frame');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  // Frame selection
  const video = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState<number | null>(view.duration);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState<{ blob: Blob; url: string } | null>(null);
  // Custom image
  const stage = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);

  useEffect(() => {
    let live = true;
    void fileUrl(file)
      .then((url) => live && setVideoUrl(url))
      .catch(() => live && setError('The video could not be loaded. Upload an image instead.'));
    return () => {
      live = false;
    };
  }, [file]);
  useEffect(() => () => {
    if (frame) URL.revokeObjectURL(frame.url);
  }, [frame]);
  useEffect(() => () => bitmap?.close(), [bitmap]);
  useEffect(() => {
    if (bitmap && stage.current) drawThumbnail(stage.current, bitmap, crop);
  }, [bitmap, crop, tab]);

  const seek = useCallback((seconds: number) => {
    const media = video.current;
    if (!media || !Number.isFinite(media.duration)) return;
    media.pause();
    media.currentTime = Math.min(Math.max(0, seconds), Math.max(0, media.duration - 0.01));
    setTime(media.currentTime);
  }, []);

  async function captureFrame() {
    setError('');
    const media = video.current;
    try {
      if (!media || media.readyState < 2 || media.seeking || !media.videoWidth)
        throw new Error('Pause on a loaded frame, then try again.');
      media.pause();
      const blob = await canvasToJpeg(drawThumbnail(document.createElement('canvas'), media));
      setFrame({ blob, url: URL.createObjectURL(blob) });
      setStatus(`Frame at ${formatVideoTime(media.currentTime)} selected. Save to apply it.`);
    } catch (problem) {
      setError(message(problem, 'Could not capture this frame.'));
    }
  }

  async function chooseImage(input?: File) {
    setError('');
    if (!input) return;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(input.type) || input.size > MAX_SOURCE_IMAGE_BYTES)
        throw new Error('Choose a JPG, PNG or WebP image up to 10 MB.');
      const decoded = await createImageBitmap(input);
      setBitmap(decoded);
      setCrop({ zoom: 1, x: 0, y: 0 });
      setStatus('Drag to reposition and use the zoom slider to crop. Save to apply it.');
    } catch (problem) {
      setError(problem instanceof Error && problem.message.startsWith('Choose') ? problem.message : 'This image could not be read.');
    }
  }

  const adjust = (next: Crop) => bitmap && setCrop(clampCrop(bitmap.width, bitmap.height, next));
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop };
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const ratio = event.currentTarget.width / event.currentTarget.getBoundingClientRect().width;
    adjust({
      ...drag.current.crop,
      x: drag.current.crop.x + (event.clientX - drag.current.x) * ratio,
      y: drag.current.crop.y + (event.clientY - drag.current.y) * ratio,
    });
  }
  function stageKey(event: KeyboardEvent<HTMLCanvasElement>) {
    const step = event.shiftKey ? 64 : 16;
    const moves: Record<string, Partial<Crop>> = {
      ArrowLeft: { x: crop.x - step },
      ArrowRight: { x: crop.x + step },
      ArrowUp: { y: crop.y - step },
      ArrowDown: { y: crop.y + step },
      '+': { zoom: crop.zoom * 1.1 },
      '=': { zoom: crop.zoom * 1.1 },
      '-': { zoom: crop.zoom / 1.1 },
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    adjust({ ...crop, ...moves[event.key] });
  }

  const pending = tab === 'frame' ? !!frame : !!bitmap;
  async function save() {
    setError('');
    setBusy(true);
    try {
      const blob = tab === 'frame' ? frame?.blob : stage.current && (await canvasToJpeg(stage.current));
      if (!blob) throw new Error(tab === 'frame' ? 'Select a frame first.' : 'Choose an image first.');
      onSaved(await saveThumbnail(file, 'custom', blob, duration));
      onClose();
    } catch (problem) {
      setError(message(problem, 'The thumbnail could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setError('');
    setBusy(true);
    try {
      const row = await saveThumbnail(file, 'restore', null, duration);
      onSaved(row);
      if (!row.auto_path) onRegenerate();
      onClose();
    } catch (problem) {
      setError(message(problem, 'The automatic thumbnail could not be restored.'));
    } finally {
      setBusy(false);
    }
  }

  const limits = bitmap ? cropLimits(bitmap.width, bitmap.height) : null;
  return (
    <div className="thumbnail-editor">
      <div className="thumbnail-editor-current">
        <span>Current</span>
        {view.url ? <img src={view.url} alt="Current thumbnail" /> : <span className="thumbnail-empty">None yet</span>}
        <small>{view.row?.custom_path ? 'Custom thumbnail' : view.row?.auto_path ? 'Automatic thumbnail' : view.generating ? 'Generating…' : 'Placeholder'}</small>
      </div>
      <div className="tabs thumbnail-tabs" role="tablist" aria-label="Thumbnail source">
        {(
          [
            ['frame', 'Choose a frame'],
            ['upload', 'Upload image'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`thumbnail-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`thumbnail-panel-${id}`}
            className={tab === id ? 'selected' : ''}
            onClick={() => {
              setTab(id);
              setError('');
              setStatus('');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="thumbnail-panel-frame" aria-labelledby="thumbnail-tab-frame" hidden={tab !== 'frame'}>
        <div className="thumbnail-frame">
          {videoUrl ? (
            <video
              ref={video}
              src={videoUrl}
              crossOrigin="anonymous"
              preload="metadata"
              playsInline
              muted
              aria-label={`Preview of ${file.name}`}
              onLoadedMetadata={(event) => {
                const media = event.currentTarget;
                if (Number.isFinite(media.duration)) setDuration(media.duration);
                // Show a real frame rather than a blank first frame while paused.
                if (media.currentTime === 0) media.currentTime = Math.min(1, (media.duration || 2) / 2);
              }}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onSeeked={(event) => setTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={(event) => (event.currentTarget.paused ? void event.currentTarget.play() : event.currentTarget.pause())}
            />
          ) : (
            <p role="status">Loading video…</p>
          )}
        </div>
        <input
          type="range"
          className="thumbnail-seek"
          aria-label="Video position"
          min={0}
          max={duration ?? 0}
          step={0.01}
          value={Math.min(time, duration ?? 0)}
          disabled={!duration}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <div className="thumbnail-controls">
          <button type="button" className="icon-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!duration}
            onClick={() => (video.current?.paused ? void video.current.play() : video.current?.pause())}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button type="button" className="secondary" disabled={!duration} onClick={() => seek(time - 1)} aria-label="Back 1 second">−1s</button>
          <button type="button" className="icon-button" disabled={!duration} onClick={() => seek(time - FRAME)} aria-label="Previous frame">
            <ChevronLeft size={17} />
          </button>
          <button type="button" className="icon-button" disabled={!duration} onClick={() => seek(time + FRAME)} aria-label="Next frame">
            <ChevronRight size={17} />
          </button>
          <button type="button" className="secondary" disabled={!duration} onClick={() => seek(time + 1)} aria-label="Forward 1 second">+1s</button>
          <span className="thumbnail-time">
            {formatVideoTime(time)} / {duration ? formatVideoTime(duration) : '–:––'}
          </span>
          <button type="button" className="secondary thumbnail-capture" disabled={!duration || busy} onClick={() => void captureFrame()}>
            Use this frame
          </button>
        </div>
        {frame && (
          <figure className="thumbnail-selected">
            <img src={frame.url} alt="Selected frame preview" />
            <figcaption>Selected thumbnail</figcaption>
          </figure>
        )}
      </div>

      <div role="tabpanel" id="thumbnail-panel-upload" aria-labelledby="thumbnail-tab-upload" hidden={tab !== 'upload'}>
        {bitmap ? (
          <canvas
            ref={stage}
            className="thumbnail-stage"
            tabIndex={0}
            role="img"
            aria-label="Thumbnail crop preview. Drag or use arrow keys to reposition, plus and minus to zoom."
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={stageKey}
          />
        ) : (
          <div className="thumbnail-frame thumbnail-drop">
            <ImageUp size={26} />
            <p>JPG, PNG or WebP up to 10 MB. It is fitted to 16:9 without stretching.</p>
          </div>
        )}
        <div className="thumbnail-controls">
          <label className="upload-button">
            <ImageUp size={16} />
            {bitmap ? 'Choose another image' : 'Choose image'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload a custom thumbnail image"
              onChange={(event) => {
                const input = event.target.files?.[0];
                event.target.value = '';
                void chooseImage(input);
              }}
            />
          </label>
          {bitmap && limits && (
            <>
              <label className="thumbnail-zoom">
                Zoom
                <input
                  type="range"
                  min={limits.min}
                  max={limits.max}
                  step={0.01}
                  value={crop.zoom}
                  onChange={(event) => adjust({ ...crop, zoom: Number(event.target.value) })}
                />
              </label>
              <button type="button" className="secondary" onClick={() => adjust({ zoom: limits.min, x: 0, y: 0 })}>
                Fit whole image
              </button>
              <button type="button" className="secondary" onClick={() => adjust({ zoom: 1, x: 0, y: 0 })}>
                Fill frame
              </button>
            </>
          )}
        </div>
      </div>

      {!available && (
        <p role="alert" className="notice error">
          Thumbnails can’t be saved yet: this portal’s database is missing the video thumbnails
          update (migration 20261112100000_portal_video_thumbnails). You can preview frames and
          images, but saving is turned off until it is applied.
        </p>
      )}
      {error && <p role="alert" className="notice error">{error}</p>}
      <p role="status" className="thumbnail-status">{busy ? 'Saving…' : status}</p>
      <div className="button-row thumbnail-actions">
        {available && view.row?.custom_path && (
          <button type="button" className="secondary" disabled={busy} onClick={() => void restore()}>
            <RotateCcw size={16} />
            Restore automatic thumbnail
          </button>
        )}
        <span className="thumbnail-spacer" />
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!available || !pending || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save thumbnail'}
        </button>
      </div>
    </div>
  );
}
