import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl } from '../../services/portal';
import type { PortalFile, VideoThumbnail } from '../../types/portal';
import {
  generateAutoThumbnail,
  isVideo,
  loadThumbnails,
  saveThumbnail,
  signThumbnails,
  thumbnailPath,
  ThumbnailError,
} from './video-thumbnails';

type Event = { id: string; generating: boolean; row?: VideoThumbnail | null };
type Job = { file: PortalFile; local?: File };

// One page-wide queue: a single video is processed at a time, idle-scheduled, and each existing
// video is attempted at most once per session so failures never loop.
const queue: Job[] = [];
const attempted = new Set<string>();
const active = new Set<string>();
const listeners = new Set<(event: Event) => void>();
let running = false;
const emit = (event: Event) => listeners.forEach((listener) => listener(event));
const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 4000 });
    else setTimeout(resolve, 800);
  });

function enqueue(job: Job) {
  if (queue.some((item) => item.file.id === job.file.id) || active.has(job.file.id)) return;
  if (!job.local && attempted.has(job.file.id)) return;
  attempted.add(job.file.id);
  if (job.local) queue.unshift(job);
  else queue.push(job);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      // Existing videos wait for an idle moment so the list and player stay responsive.
      if (!job.local) await idle();
      active.add(job.file.id);
      emit({ id: job.file.id, generating: true });
      let row: VideoThumbnail | null = null;
      try {
        const { image, duration } = await generateAutoThumbnail(job.local ?? (await fileUrl(job.file)));
        row = await saveThumbnail(job.file, 'auto', image, duration);
      } catch (error) {
        // Record decode failures once so other admins do not retry; transient errors retry next session.
        if (error instanceof ThumbnailError && error.permanent)
          row = await saveThumbnail(job.file, 'auto', null, null).catch(() => null);
      } finally {
        active.delete(job.file.id);
        emit({ id: job.file.id, generating: false, row });
      }
    }
  } finally {
    running = false;
  }
}

export type ThumbnailView = {
  row?: VideoThumbnail;
  url?: string;
  duration: number | null;
  generating: boolean;
};

export function useVideoThumbnails(files: PortalFile[], admin: boolean) {
  const videos = useMemo(() => files.filter(isVideo), [files]);
  const ids = videos.map((file) => file.id).join(',');
  const [rows, setRows] = useState<Record<string, VideoThumbnail>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(async (list: VideoThumbnail[]) => {
    if (!list.length) return;
    setRows((previous) => ({ ...previous, ...Object.fromEntries(list.map((row) => [row.file_id, row])) }));
    const paths = list.flatMap((row) => (thumbnailPath(row) ? [thumbnailPath(row)!] : []));
    if (!paths.length) return;
    const signed = await signThumbnails(paths).catch(() => new Map<string, string>());
    if (mounted.current) setUrls((previous) => ({ ...previous, ...Object.fromEntries(signed) }));
  }, []);

  useEffect(() => {
    const listener = ({ id, generating: busy, row }: Event) => {
      setGenerating((previous) => ({ ...previous, [id]: busy }));
      if (row) void apply([row]);
    };
    listeners.add(listener);
    setGenerating(Object.fromEntries([...active].map((id) => [id, true])));
    return () => {
      listeners.delete(listener);
    };
  }, [apply]);

  // One row query and one batch signing request per workspace, not per thumbnail.
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    void loadThumbnails(ids.split(','), controller.signal)
      .then(async (list) => {
        if (controller.signal.aborted) return;
        if (list === null) {
          setAvailable(false);
          return;
        }
        await apply(list);
        if (!controller.signal.aborted) setLoaded(ids);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [ids, apply]);

  // Controlled backfill: only admins generate, only for videos in the open workspace.
  useEffect(() => {
    if (!admin || !available || loaded !== ids) return;
    const timer = window.setTimeout(() => {
      for (const file of videos) {
        const row = rows[file.id];
        if (!row || (!row.auto_path && !row.custom_path && !row.auto_failed_at)) enqueue({ file });
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [admin, available, loaded, ids, videos, rows]);

  const view = useCallback(
    (file: PortalFile): ThumbnailView => {
      const row = rows[file.id];
      const path = thumbnailPath(row);
      return {
        row,
        url: path ? urls[path] : undefined,
        duration: row?.duration_seconds ? Number(row.duration_seconds) : null,
        generating: !!generating[file.id],
      };
    },
    [rows, urls, generating],
  );

  /** Generate from the admin's local copy right after upload: no video download is needed. */
  const generateFromUpload = useCallback((file: PortalFile, local: File) => {
    if (isVideo(file)) enqueue({ file, local });
  }, []);

  /** After restoring with no automatic thumbnail saved yet, try generating one again. */
  const regenerate = useCallback((file: PortalFile) => {
    attempted.delete(file.id);
    enqueue({ file });
  }, []);

  return { view, apply, generateFromUpload, regenerate, available };
}
