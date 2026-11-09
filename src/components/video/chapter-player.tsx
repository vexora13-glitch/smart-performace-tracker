import { Film } from "lucide-react";
import { memo, useId, useRef, useState, type RefObject } from "react";
import { activeChapter, formatVideoTime, type Chapter } from "./video-chapters";
import styles from "./video.module.css";

export const ChapterThumbnail = memo(function ChapterThumbnail({ url }: { url?: string }) {
  const [failed, setFailed] = useState<string>();
  return <span className={styles.thumbnail} aria-hidden="true">
    {/* Private, signed thumbnails are already sized for this slot. */}
    {url && failed !== url ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} /> : <Film size={19} />}
  </span>;
});

const ChapterList = memo(function ChapterList({ chapters, current, seek, id }: {
  chapters: Chapter[]; current?: string; seek: (seconds: number) => void; id: string;
}) {
  return <nav id={id} aria-label="Video chapters" className={styles.chapterPanel}>
    <ol>
      {chapters.map(chapter => <li key={chapter.id}>
        <button type="button" aria-current={current === chapter.id ? "true" : undefined} onClick={() => seek(chapter.start)}>
          <ChapterThumbnail url={chapter.thumbnailUrl} />
          <span className={styles.chapterCopy}>
            <span className={styles.chapterTime}>{formatVideoTime(chapter.start)}</span>
            <strong>{chapter.title}</strong>
            {chapter.description && <small>{chapter.description}</small>}
          </span>
        </button>
      </li>)}
    </ol>
  </nav>;
});

export type Playback = { url: string; chapters: Chapter[]; title: string };

export function ChapterPlayer({ playback, videoRef, onRetry, resumeAt = 0, autoPlay = false }: {
  playback: Playback; videoRef?: RefObject<HTMLVideoElement | null>; onRetry?: (seconds: number) => void; resumeAt?: number; autoPlay?: boolean;
}) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? internalRef;
  const pendingSeek = useRef<number | null>(resumeAt || null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(false);
  const [panel, setPanel] = useState(true);
  const chapterId = useId();
  const { chapters, title, url } = playback;
  const current = activeChapter(chapters, time);

  function seek(seconds: number) {
    const video = ref.current;
    if (!video || !Number.isFinite(seconds)) return;
    if (!Number.isFinite(video.duration)) {
      pendingSeek.current = Math.max(0, seconds);
      return;
    }
    setDuration(video.duration);
    video.currentTime = Math.min(video.duration, Math.max(0, seconds));
    setTime(video.currentTime);
  }

  function readDuration(video: HTMLVideoElement) {
    if (!Number.isFinite(video.duration)) return;
    setDuration(video.duration);
    const seconds = pendingSeek.current;
    if (seconds !== null) {
      pendingSeek.current = null;
      seek(seconds);
    }
  }

  return <section className={styles.player} aria-label={`Video player for ${title}`}>
    {chapters.length > 0 && <div className={styles.playerHeading}>
      <span>{chapters.length} {chapters.length === 1 ? "chapter" : "chapters"}</span>
      <button type="button" aria-expanded={panel} aria-controls={panel ? chapterId : undefined} onClick={() => setPanel(open => !open)}>
        {panel ? "Hide chapters" : "Show chapters"}
      </button>
    </div>}
    <div className={`${styles.playerGrid} ${panel && chapters.length ? styles.withChapters : ""}`}>
      <div className={styles.media}>
        {/* The portal currently stores MP4 files without a separate caption track. */}
        <video ref={ref} src={url} crossOrigin={videoRef ? "anonymous" : undefined} aria-label={title}
          controls playsInline preload="metadata" autoPlay={autoPlay}
          onLoadedMetadata={event => readDuration(event.currentTarget)}
          onDurationChange={event => readDuration(event.currentTarget)}
          onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
          onProgress={event => {
            const ranges = event.currentTarget.buffered;
            setBuffered(Array.from({ length: ranges.length }, (_, i) => [ranges.start(i), ranges.end(i)]));
          }}
          onWaiting={() => setWaiting(true)} onCanPlay={event => { readDuration(event.currentTarget); setWaiting(false); }}
          onPlaying={() => setWaiting(false)} onSeeked={() => setWaiting(false)}
          onPause={() => setWaiting(false)} onError={() => { setError(true); setWaiting(false); }}
          onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const key = event.key.toLowerCase();
            if (key === "j" || key === "l") {
              event.preventDefault();
              seek(event.currentTarget.currentTime + (key === "j" ? -10 : 10));
            }
          }}
        />
        {error ? <div className={styles.playbackError}>
          <p role="alert">This video could not be played. Try reloading it or use the download link if available.</p>
          {onRetry && <button type="button" onClick={() => onRetry(time)}>Reload video</button>}
        </div> : waiting && <span className={styles.waiting} role="status">Buffering video…</span>}
        {duration > 0 && <div className={styles.timeline}>
          <div className={styles.timelineTrack} aria-hidden="true">
            {buffered.map(([start, end]) => <span key={start} className={styles.buffered}
              style={{ left: `${100 * start / duration}%`, width: `${100 * (end - start) / duration}%` }} />)}
            <span className={styles.played} style={{ width: `${100 * Math.min(time / duration, 1)}%` }} />
          </div>
          <input type="range" min="0" max={duration} step="any" value={Math.min(time, duration)}
            aria-label="Seek video" aria-valuetext={`${formatVideoTime(time)} of ${formatVideoTime(duration)}`}
            onKeyDown={event => {
              const offsets: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
              if (event.key in offsets) {
                event.preventDefault();
                seek(time + offsets[event.key]);
              }
            }}
            onChange={event => seek(event.currentTarget.valueAsNumber)} />
          {chapters.filter(chapter => chapter.start < duration).sort((a, b) => a.start - b.start).map(chapter => <button type="button"
            key={chapter.id} className={styles.marker}
            style={{ left: `${100 * chapter.start / duration}%` }}
            aria-label={`Jump to ${chapter.title} at ${formatVideoTime(chapter.start)}`}
            title={`${formatVideoTime(chapter.start)} · ${chapter.title}`}
            aria-current={current === chapter.id ? "true" : undefined} onClick={() => seek(chapter.start)} />)}
        </div>}
        {duration > 0 && <div className={styles.playbackTools}>
          <span>{formatVideoTime(time)} / {formatVideoTime(duration)}</span>
          <button type="button" onClick={() => seek(time - 10)} aria-label="Back 10 seconds">−10s</button>
          <button type="button" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds">+10s</button>
          <label><span className={styles.srOnly}>Playback speed</span>
            <select defaultValue="1" onChange={event => { if (ref.current) ref.current.playbackRate = Number(event.target.value); }}>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
            </select>
          </label>
        </div>}
      </div>
      {panel && chapters.length > 0 && <ChapterList id={chapterId} chapters={chapters} seek={seek} current={current} />}
    </div>
  </section>;
}
