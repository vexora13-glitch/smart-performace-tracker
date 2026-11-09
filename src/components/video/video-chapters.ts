export const MAX_CHAPTERS = 50;
export const MAX_THUMBNAIL_BYTES = 180 * 1024;
export const THUMBNAIL_WIDTH = 480;
export const MAX_CHAPTER_SECONDS = 24 * 60 * 60;

export type Chapter = {
  id: string;
  title: string;
  description: string;
  start: number;
  end: number | null;
  thumbnailPath: string | null;
  thumbnailUrl?: string;
};

export function formatVideoTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const tail = String(total % 60).padStart(2, "0");
  return minutes < 60 ? `${minutes}:${tail}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${tail}`;
}

export function parseVideoTime(value: string) {
  const text = value.trim();
  if (/^\d+(\.\d{1,3})?$/.test(text)) return Number(text);
  if (!/^\d+(?::[0-5]\d){1,2}(\.\d{1,3})?$/.test(text)) return NaN;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function activeChapter(chapters: Chapter[], seconds: number) {
  // Chapter records support milliseconds; media engines may round seeks to microseconds.
  const timestamp = Math.round(seconds * 1000) / 1000;
  let current: Chapter | undefined;
  for (const chapter of chapters) {
    if (Math.round(chapter.start * 1000) / 1000 <= timestamp && (!current || chapter.start > current.start)) current = chapter;
  }
  return current && (current.end === null || timestamp < current.end) ? current.id : undefined;
}

export function chapterError(chapters: Chapter[], duration: number | null) {
  const ordered = [...chapters].sort((a, b) => a.start - b.start);
  for (const [index, chapter] of ordered.entries()) {
    const name = chapter.title.trim();
    if (!name || name.length > 120) return "Give each chapter a title of 1–120 characters.";
    if (!Number.isFinite(chapter.start) || chapter.start < 0 || chapter.start >= (duration ?? MAX_CHAPTER_SECONDS)) {
      return `Enter a start time within the video for “${name}”.`;
    }
    if (chapter.end !== null && (!Number.isFinite(chapter.end) || chapter.end <= chapter.start || chapter.end > (duration ?? MAX_CHAPTER_SECONDS))) {
      return `Enter an end time after the start and within the video for “${name}”.`;
    }
    const next = ordered[index + 1];
    if (next && (chapter.start === next.start || (chapter.end !== null && chapter.end > next.start))) {
      return "Give chapters unique start times and avoid overlapping sections.";
    }
  }
}
