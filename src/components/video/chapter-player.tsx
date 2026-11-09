import { Captions, Film, Layers, Maximize, Minimize, PanelRightClose, PanelRightOpen, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings, TvMinimal, Volume2, VolumeX, X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { activeChapter, formatVideoTime, type Chapter } from './video-chapters';
import styles from './video.module.css';

export const ChapterThumbnail = memo(function ChapterThumbnail({ url }: { url?: string }) {
  const [failed, setFailed] = useState<string>();
  return <span className={styles.thumbnail} aria-hidden="true">
    {url && failed !== url ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} /> : <Film size={24} />}
  </span>;
});

const ChapterList = memo(function ChapterList({ chapters, current, seek, id, duration, hidden }: {
  chapters: Chapter[]; current?: string; seek: (seconds: number) => void; id: string; duration: number; hidden: boolean;
}) {
  return <nav id={id} aria-label="Video chapters" className={styles.chapterPanel} hidden={hidden}>
    <div className={styles.chapterHeader}><h2><Layers /> Video Chapters</h2><span>{formatVideoTime(duration)}</span></div>
    <ol>
      {chapters.map((chapter, index) => <li key={chapter.id}>
        <button type="button" aria-label={`Chapter ${index + 1}: ${chapter.title}, ${formatVideoTime(chapter.start)}`} aria-current={current === chapter.id ? 'true' : undefined} onClick={() => seek(chapter.start)}
          title={[chapter.title, chapter.description].filter(Boolean).join(' — ')}>
          <span className={styles.chapterNumber}>{index + 1}</span>
          <ChapterThumbnail url={chapter.thumbnailUrl} />
          <span className={styles.chapterCopy}><strong>{chapter.title}</strong></span>
          <span className={styles.chapterTime}>{formatVideoTime(chapter.start)}</span>
        </button>
      </li>)}
    </ol>
  </nav>;
});

export type Playback = { url: string; chapters: Chapter[]; title: string; captions?: { src: string; language: string; label: string }[] };

export function ChapterPlayer({ playback, videoRef, onRetry, resumeAt = 0, autoPlay = false, onClose }: {
  playback: Playback; videoRef?: RefObject<HTMLVideoElement | null>; onRetry?: (seconds: number) => void; resumeAt?: number; autoPlay?: boolean; onClose?: () => void;
}) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? internalRef;
  const mediaRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [chaptersVisible, setChaptersVisible] = useState(true);
  const [theatre, setTheatre] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(resumeAt || null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rate, setRate] = useState(1);
  const [captionCount, setCaptionCount] = useState(0);
  const [captioned, setCaptioned] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const [status, setStatus] = useState('');
  const chapterId = useId();
  const { chapters, title, url, captions } = playback;
  const current = activeChapter(chapters, time);

  useEffect(() => { setEnhanced(true); }, []);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === mediaRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const tracks = ref.current?.textTracks;
    if (!tracks) return;
    const update = () => {
      const available = Array.from(tracks).filter(track => ['captions', 'subtitles'].includes(track.kind));
      setCaptionCount(available.length);
      setCaptioned(available.some(track => track.mode === 'showing'));
    };
    update();
    tracks.addEventListener('addtrack', update);
    tracks.addEventListener('change', update);
    tracks.addEventListener('removetrack', update);
    return () => { tracks.removeEventListener('addtrack', update); tracks.removeEventListener('change', update); tracks.removeEventListener('removetrack', update); };
  }, [ref, url]);
  useEffect(() => {
    if (!settings) return;
    const close = (event: PointerEvent) => { if (!settingsRef.current?.contains(event.target as Node)) setSettings(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [settings]);

  const seek = useCallback((seconds: number) => {
    const video = ref.current;
    if (!video || !Number.isFinite(seconds)) return;
    if (!Number.isFinite(video.duration)) { pendingSeek.current = Math.max(0, seconds); return; }
    setDuration(video.duration);
    video.currentTime = Math.min(video.duration, Math.max(0, seconds));
    setTime(video.currentTime);
  }, [ref]);
  function readDuration(video: HTMLVideoElement) {
    if (!Number.isFinite(video.duration)) return;
    setDuration(video.duration);
    if (pendingSeek.current !== null) { const seconds = pendingSeek.current; pendingSeek.current = null; seek(seconds); }
  }
  async function togglePlay() {
    const video = ref.current;
    if (!video) return;
    try { if (video.paused) await video.play(); else video.pause(); setStatus(''); }
    catch { setStatus('Playback could not start. Please try again.'); }
  }
  async function toggleFullscreen() {
    const video = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (mediaRef.current?.requestFullscreen) await mediaRef.current.requestFullscreen();
      else video?.webkitEnterFullscreen?.();
    } catch { setStatus('Fullscreen is unavailable in this browser.'); }
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await ref.current?.requestPictureInPicture();
    } catch { setStatus('Picture-in-picture is unavailable for this video.'); }
  }
  async function fullscreenWorkspace() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (workspaceRef.current?.requestFullscreen) await workspaceRef.current.requestFullscreen();
      else await toggleFullscreen();
    } catch { setStatus('Fullscreen is unavailable in this browser.'); }
  }
  function toggleCaptions() {
    const tracks = Array.from(ref.current?.textTracks ?? []).filter(track => ['captions', 'subtitles'].includes(track.kind));
    tracks.forEach((track, index) => { track.mode = !captioned && index === 0 ? 'showing' : 'disabled'; });
  }
  const displayTitle = title.replace(/\.(mp4|webm|mov|m4v)$/i, '');
  const showChapters = chaptersVisible && !theatre;
  return <section ref={workspaceRef} className={`${styles.player} ${onClose ? styles.immersive : ''} ${theatre ? styles.theatre : ''}`} aria-label={`Video player for ${title}`}>
    <header className={styles.playerHeading}>
      <div className={styles.headingCopy}><h2 title={displayTitle}>{displayTitle}</h2><span>{formatVideoTime(duration)} · {chapters.length} chapters</span></div>
      <div className={styles.headingTools}>
        {chapters.length > 0 && <button type="button" aria-label={showChapters ? 'Hide chapters' : 'Show chapters'} aria-controls={chapterId} aria-expanded={showChapters} onClick={() => { setChaptersVisible(!showChapters); setTheatre(false); }}>{showChapters ? <PanelRightClose /> : <PanelRightOpen />}</button>}
        <button type="button" aria-label={theatre ? 'Exit theatre mode' : 'Enter theatre mode'} aria-pressed={theatre} onClick={() => setTheatre(value => !value)}><TvMinimal /></button>
        <button type="button" aria-label="Fullscreen workspace" onClick={() => void fullscreenWorkspace()}><Maximize /></button>
        {onClose && <button type="button" aria-label="Close video" onClick={onClose}><X /></button>}
      </div>
    </header>
    <div className={`${styles.playerGrid} ${chapters.length && showChapters ? styles.withChapters : ''}`}>
      <div className={styles.media} ref={mediaRef} onKeyDown={event => {
        if ((event.target as HTMLElement).closest('button,input,select') || event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if ([' ', 'k', 'j', 'l', 'arrowleft', 'arrowright', 'm', 'f'].includes(key)) event.preventDefault();
        if (key === ' ' || key === 'k') void togglePlay();
        if (key === 'j' || key === 'arrowleft') seek(time - (key === 'j' ? 10 : 5));
        if (key === 'l' || key === 'arrowright') seek(time + (key === 'l' ? 10 : 5));
        if (key === 'm' && ref.current) ref.current.muted = !ref.current.muted;
        if (key === 'f') void toggleFullscreen();
      }}>
        <video ref={ref} src={url} crossOrigin={videoRef || captions?.length ? 'anonymous' : undefined} aria-label={title}
          controls={!enhanced} tabIndex={0} playsInline preload="metadata" autoPlay={autoPlay}
          onClick={() => { if (enhanced) void togglePlay(); }}
          onLoadedMetadata={event => readDuration(event.currentTarget)} onDurationChange={event => readDuration(event.currentTarget)}
          onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
          onProgress={event => { const ranges = event.currentTarget.buffered; setBuffered(Array.from({ length: ranges.length }, (_, i) => [ranges.start(i), ranges.end(i)])); }}
          onWaiting={() => setWaiting(true)} onCanPlay={event => { readDuration(event.currentTarget); setWaiting(false); }}
          onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setWaiting(false); }}
          onSeeked={() => setWaiting(false)} onPause={() => { setPlaying(false); setWaiting(false); }} onEnded={() => setPlaying(false)}
          onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
          onRateChange={event => setRate(event.currentTarget.playbackRate)}
          onError={event => {
            const code = event.currentTarget.error?.code;
            setError(code === 3 ? 'The browser could not decode this video. Try an MP4 encoded with H.264/AAC, or download the original.' :
              code === 4 ? 'This video format is unsupported, or its storage link is unavailable. Reload the link or download the original.' :
              'The video transfer was interrupted. Reload the link to retry, or download the original.');
            setWaiting(false);
          }}>
          {captions?.map(track => <track key={track.src} kind="captions" src={track.src} srcLang={track.language} label={track.label} />)}
        </video>
        {waiting && !error && <span className={styles.waiting} role="status">Buffering video…</span>}
        {error && <div className={styles.playbackError}><p role="alert">{error}</p>
          {onRetry && <button type="button" onClick={() => onRetry(time)}>Reload video</button>}</div>}
        {enhanced && <div className={styles.controlBar}>
          <div className={styles.timeline}>
            <div className={styles.timelineTrack} aria-hidden="true">
              {buffered.map(([start, end]) => <span key={start} className={styles.buffered} style={{ left: `${100 * start / duration}%`, width: `${100 * (end - start) / duration}%` }} />)}
              <span className={styles.played} style={{ width: `${duration ? 100 * Math.min(time / duration, 1) : 0}%` }} />
            </div>
            <input type="range" min="0" max={duration || 1} step="any" value={Math.min(time, duration)} disabled={!duration}
              aria-label="Seek video" aria-valuetext={`${formatVideoTime(time)} of ${formatVideoTime(duration)}`}
              onKeyDown={event => { const offsets: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }; if (event.key in offsets) { event.preventDefault(); seek(time + offsets[event.key]); } }}
              onChange={event => seek(event.currentTarget.valueAsNumber)} />
            {duration > 0 && chapters.filter(chapter => chapter.start < duration).map(chapter => <button type="button" key={chapter.id} className={styles.marker}
              style={{ left: `${100 * chapter.start / duration}%` }} aria-label={`Jump to ${chapter.title} at ${formatVideoTime(chapter.start)}`}
              title={`${formatVideoTime(chapter.start)} · ${chapter.title}`} aria-current={current === chapter.id ? 'true' : undefined} onClick={() => seek(chapter.start)} />)}
          </div>
          <div className={styles.playbackTools}>
            <button type="button" onClick={() => void togglePlay()} aria-label={playing ? 'Pause video' : 'Play video'}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
            <button type="button" onClick={() => seek(time - 10)} aria-label="Back 10 seconds"><RotateCcw /><small>10</small></button>
            <button type="button" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds"><RotateCw /><small>10</small></button>
            <span className={styles.clock}>{formatVideoTime(time)} / {formatVideoTime(duration)}</span>
            <div className={styles.volume}>
              <button type="button" onClick={() => { if (ref.current) ref.current.muted = !ref.current.muted; }} aria-label={muted || volume === 0 ? 'Unmute video' : 'Mute video'}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</button>
              <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Video volume" onChange={event => { if (ref.current) { ref.current.volume = event.currentTarget.valueAsNumber; ref.current.muted = false; } }} />
            </div>
            <button type="button" aria-label="Toggle captions" aria-pressed={captioned} disabled={!captionCount} title={captionCount ? 'Captions' : 'No captions available'} onClick={toggleCaptions}><Captions /></button>
            <div className={styles.settings} ref={settingsRef}>
              <button type="button" aria-label="Playback settings" aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings /></button>
              {settings && <div className={styles.settingsMenu} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSettings(false); settingsRef.current?.querySelector('button')?.focus(); } }}>
                <label>Playback speed<select autoFocus value={rate} onChange={event => { if (ref.current) ref.current.playbackRate = Number(event.target.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
                {captionCount > 0 && <label>Captions<select value={Array.from(ref.current?.textTracks ?? []).findIndex(track => track.mode === 'showing')} onChange={event => Array.from(ref.current?.textTracks ?? []).forEach((track, index) => { track.mode = index === Number(event.target.value) ? 'showing' : 'disabled'; })}><option value={-1}>Off</option>{Array.from(ref.current?.textTracks ?? []).map((track, index) => ['captions', 'subtitles'].includes(track.kind) && <option key={index} value={index}>{track.label || track.language}</option>)}</select></label>}
              </div>}
            </div>
            <button type="button" aria-label="Picture in picture" disabled={!document.pictureInPictureEnabled} onClick={() => void togglePip()}><PictureInPicture2 /></button>
            <button type="button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize /> : <Maximize />}</button>
          </div>
        </div>}
      </div>
      {chapters.length > 0 && <ChapterList id={chapterId} chapters={chapters} duration={duration} seek={seek} current={current} hidden={!showChapters} />}
    </div>
    {!theatre && <details className={styles.information}><summary>About this presentation</summary><p>Choose a chapter to jump to a section. Keyboard: Space or K to play/pause, J/L to skip, M to mute and F for fullscreen. Playback links last one hour; reload an expired link to continue.</p></details>}
    {status && <p role="status">{status}</p>}
  </section>;
}
