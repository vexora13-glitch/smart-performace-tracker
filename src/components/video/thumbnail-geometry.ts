// Pure 16:9 thumbnail geometry and frame selection rules (no DOM or network), shared and unit-tested.

/** Sharp at 2x the ~120 px list size and on the editor preview. */
export const THUMB_WIDTH = 640;
export const THUMB_HEIGHT = 360;

/** zoom 1 covers the 16:9 frame; x/y pan the image centre in canvas pixels. */
export type Crop = { zoom: number; x: number; y: number };

/**
 * Scale limits for a crop. The minimum fits the whole source (letterboxed), so scaling is
 * always uniform and nothing is stretched.
 */
export function cropLimits(width: number, height: number) {
  const cover = Math.max(THUMB_WIDTH / width, THUMB_HEIGHT / height);
  const contain = Math.min(THUMB_WIDTH / width, THUMB_HEIGHT / height);
  return { cover, min: contain / cover, max: 4 };
}

/** Clamp zoom and pan so a covering image never leaves gaps; smaller images stay centred. */
export function clampCrop(width: number, height: number, crop: Crop): Crop {
  const { cover, min, max } = cropLimits(width, height);
  const zoom = Math.min(max, Math.max(min, crop.zoom));
  const limitX = Math.max(0, (width * cover * zoom - THUMB_WIDTH) / 2);
  const limitY = Math.max(0, (height * cover * zoom - THUMB_HEIGHT) / 2);
  return { zoom, x: Math.min(limitX, Math.max(-limitX, crop.x)), y: Math.min(limitY, Math.max(-limitY, crop.y)) };
}

/** Frames close to 16:9 fill the area; portrait or very wide video keeps its full picture. */
export function defaultCrop(width: number, height: number): Crop {
  const ratio = width / height / (16 / 9);
  return { zoom: ratio > 0.9 && ratio < 1.1 ? 1 : cropLimits(width, height).min, x: 0, y: 0 };
}

/** Destination rectangle for drawing a source into the thumbnail canvas. */
export function placement(width: number, height: number, crop: Crop = defaultCrop(width, height)) {
  const view = clampCrop(width, height, crop);
  const scale = cropLimits(width, height).cover * view.zoom;
  const w = width * scale;
  const h = height * scale;
  return { x: (THUMB_WIDTH - w) / 2 + view.x, y: (THUMB_HEIGHT - h) / 2 + view.y, width: w, height: h };
}

/** A few seek points past any fade-in/black opening; unknown duration falls back to early frames. */
export function candidateTimes(duration: number | null) {
  if (!duration) return [1, 0.1];
  const latest = Math.max(0, duration - 0.25);
  const times = [0.12, 0.3, 0.5].map((part) => Math.min(Math.max(duration * part, Math.min(1, duration / 2)), latest));
  return [...new Set(times.map((time) => Math.round(time * 1000) / 1000))];
}

/** Luminance statistics (0–255): a frame is representative when it is neither dark nor uniform. */
export function isRepresentative(score: { mean: number; spread: number }) {
  return score.mean > 28 && score.spread > 14;
}
export function frameValue(score: { mean: number; spread: number }) {
  return score.spread + Math.min(score.mean, 60) * 0.5;
}
