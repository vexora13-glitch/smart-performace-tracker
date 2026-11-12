import { db, unwrap } from '../../services/portal';
import type { PortalFile, VideoThumbnail } from '../../types/portal';
import { candidateTimes, frameValue, isRepresentative, placement, THUMB_HEIGHT, THUMB_WIDTH, type Crop } from './thumbnail-geometry';

export { clampCrop, cropLimits, type Crop } from './thumbnail-geometry';
export const MAX_LIST_THUMBNAIL_BYTES = 320 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const LETTERBOX = '#030913';
const SIGNED_SECONDS = 3600;

const bucket = () => db().storage.from('portal-private');
export const isVideo = (file: PortalFile) => file.mime_type === 'video/mp4' || file.mime_type === 'video/webm';
export const thumbnailPath = (row?: VideoThumbnail | null) => row?.custom_path ?? row?.auto_path ?? null;

// Thumbnail object paths are unique per save, so a signed URL can be reused until it nears expiry.
const signed = new Map<string, { url: string; expires: number }>();
export async function signThumbnails(paths: string[]) {
  const now = Date.now();
  const missing = [...new Set(paths)].filter((path) => (signed.get(path)?.expires ?? 0) - now < 5 * 60_000);
  if (missing.length) {
    const { data } = await bucket().createSignedUrls(missing, SIGNED_SECONDS);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error)
        signed.set(item.path, { url: item.signedUrl, expires: now + SIGNED_SECONDS * 1000 });
    }
  }
  return new Map(paths.flatMap((path) => (signed.has(path) ? [[path, signed.get(path)!.url] as const] : [])));
}

/** Null when the thumbnails migration is not applied yet: the list keeps working with placeholders. */
export async function loadThumbnails(fileIds: string[], signal?: AbortSignal) {
  if (!fileIds.length) return [];
  const rows: VideoThumbnail[] = [];
  for (let i = 0; i < fileIds.length; i += 100) {
    const query = db()
      .from('portal_video_thumbnails')
      .select('file_id,auto_path,custom_path,duration_seconds,auto_failed_at,updated_at')
      .in('file_id', fileIds.slice(i, i + 100));
    const result = signal ? await query.abortSignal(signal) : await query;
    if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') return null;
    rows.push(...(unwrap(result) as VideoThumbnail[]));
  }
  return rows;
}

type Source = 'auto' | 'custom' | 'restore';
/** Admin-only. Storage and the RPC both enforce staff access server-side. */
export async function saveThumbnail(file: PortalFile, source: Source, image: Blob | null, duration: number | null) {
  let path: string | null = null;
  if (image) {
    path = `${file.workspace_id}/video-thumbnails/${file.id}/${crypto.randomUUID()}.jpg`;
    unwrap(await bucket().upload(path, image, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }));
  }
  const response = await db().rpc('portal_save_video_thumbnail', {
    video: file.id,
    source,
    path,
    duration: duration && Number.isFinite(duration) && duration > 0 && duration <= 86400 ? Math.round(duration * 1000) / 1000 : null,
  });
  if (response.error || !response.data || typeof response.data !== 'object') {
    if (path) await bucket().remove([path]).catch(() => {});
    throw new Error(response.error?.message || 'The thumbnail could not be saved.');
  }
  const { discard, ...row } = response.data as VideoThumbnail & { discard: string | null };
  // Replaced objects are no longer referenced; removal failure leaves only an unreadable orphan.
  if (discard) {
    signed.delete(discard);
    void bucket().remove([discard]).then(() => {}, () => {});
  }
  return row as VideoThumbnail;
}

/** Natural size for a decoded image or video frame. */
export function sourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof ImageBitmap) return { width: source.width, height: source.height };
  const element = source as HTMLImageElement;
  return { width: element.naturalWidth || element.width, height: element.naturalHeight || element.height };
}

/** Draw a source into the 16:9 thumbnail frame with uniform scaling only. */
export function drawThumbnail(canvas: HTMLCanvasElement, source: CanvasImageSource, crop?: Crop) {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error('This frame is not ready yet.');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.fillStyle = LETTERBOX;
  context.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const target = placement(width, height, crop);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, target.x, target.y, target.width, target.height);
  return canvas;
}

export async function canvasToJpeg(canvas: HTMLCanvasElement) {
  for (const quality of [0.84, 0.74, 0.62]) {
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (image && image.size <= MAX_LIST_THUMBNAIL_BYTES) return image;
  }
  throw new Error('Could not prepare this thumbnail.');
}

/** Mean luminance and contrast of a frame, sampled at 32x18 to keep the check cheap. */
function frameScore(source: CanvasImageSource) {
  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 18;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return { mean: 128, spread: 64 };
  context.drawImage(source, 0, 0, 32, 18);
  const pixels = context.getImageData(0, 0, 32, 18).data; // Throws SecurityError for tainted media.
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    sum += value;
    squares += value * value;
  }
  const count = pixels.length / 4;
  const mean = sum / count;
  return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
}

export class ThumbnailError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}

function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal | undefined, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      window.clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const ok = () => done();
    const failed = () => {
      const code = video.error?.code;
      // 3/4: decode or unsupported format, which will not succeed on retry.
      done(new ThumbnailError('This video could not be decoded for a thumbnail.', code === 3 || code === 4));
    };
    const aborted = () => done(new DOMException('Thumbnail generation stopped.', 'AbortError'));
    const timer = window.setTimeout(() => done(new ThumbnailError('Thumbnail generation timed out.', false)), ms);
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/**
 * Pick a representative frame. A local File is read from memory; a signed URL is read with
 * HTTP range requests, so only the container index and a few seek points are fetched.
 */
export async function generateAutoThumbnail(source: File | string, signal?: AbortSignal) {
  const video = document.createElement('video');
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  if (!objectUrl) video.crossOrigin = 'anonymous';
  try {
    const ready = waitFor(video, 'loadedmetadata', signal, 30_000);
    video.src = objectUrl ?? (source as string);
    await ready;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const candidates = candidateTimes(duration);
    let best: { canvas: HTMLCanvasElement; score: number } | null = null;
    for (const time of candidates) {
      if (Math.abs(video.currentTime - time) > 0.01 || video.readyState < 2) {
        const seeked = waitFor(video, 'seeked', signal, 20_000);
        video.currentTime = time;
        await seeked;
      }
      if (video.readyState < 2) await waitFor(video, 'loadeddata', signal, 15_000);
      let score;
      try {
        score = frameScore(video);
      } catch (error) {
        throw error instanceof DOMException && error.name === 'SecurityError'
          ? new ThumbnailError('The video host blocked frame capture.', true)
          : error;
      }
      const canvas = drawThumbnail(document.createElement('canvas'), video);
      // Prefer the first clearly visible, non-uniform frame; otherwise keep the most detailed one.
      const value = frameValue(score);
      if (!best || value > best.score) best = { canvas, score: value };
      if (isRepresentative(score)) break;
    }
    if (!best) throw new ThumbnailError('No frame could be read from this video.', true);
    return { image: await canvasToJpeg(best.canvas), duration };
  } finally {
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
