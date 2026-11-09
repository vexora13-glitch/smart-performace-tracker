import type { DetailedError } from 'tus-js-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export type UploadProgress = { percent: number; phase: 'uploading' | 'retrying' | 'saving' };
export type UploadOptions = { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void };
export const VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;
export const DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;

export function uploadEndpoint(base: string) {
  const url = new URL(base);
  if (/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/storage/v1/upload/resumable`;
  return url.href;
}

export function uploadError(error: Error) {
  const response = (error as DetailedError).originalResponse;
  const status = response?.getStatus();
  let detail = '';
  try { const body = JSON.parse(response?.getBody() || '{}'); detail = body.message || body.error || ''; } catch { /* A proxy can return plain text. */ }
  if (status === 413 || /maximum allowed size|exceeded.*size|too large/i.test(detail))
    return new Error(`Storage rejected this file (${status || 'size limit'}). The Supabase project global limit and portal-private bucket must both allow 200 MiB videos. ${detail}`.trim());
  if (status === 401 || status === 403) return new Error(`Storage denied this upload (${status}). Check your sign-in and workspace permissions. ${detail}`.trim());
  if (status === 415 || /mime type.*not supported/i.test(detail)) return new Error(`Storage does not allow this file type. Choose an MP4 or WebM video and check the bucket's allowed MIME types. ${detail}`.trim());
  return new Error(`Upload interrupted${status ? ` (storage ${status})` : ''}. Resume to retry from the last saved chunk. ${detail}`.trim());
}

/** Browser -> private Storage in 6 MiB chunks. No video bytes pass through the portal API. */
export async function resumableUpload(client: SupabaseClient, workspace: string, file: File, path: string, options: UploadOptions) {
  const { Upload } = await import('tus-js-client');
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) throw new Error('Sign in to upload files.');
  const endpoint = uploadEndpoint(import.meta.env.VITE_SUPABASE_URL);
  let objectPath = path;
  let percent = 0;
  const report = (phase: UploadProgress['phase']) => options.onProgress?.({ percent, phase });
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      options.signal?.removeEventListener('abort', pause);
      if (error) reject(error); else resolve();
    };
    const upload = new Upload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // Separate users/workspaces and retain no bearer tokens in URL storage.
      fingerprint: async () => JSON.stringify(['portal-v1', session.user.id, workspace, file.name, file.type, file.size, file.lastModified]),
      headers: { 'x-upsert': 'false' },
      metadata: { bucketName: 'portal-private', objectName: path, contentType: file.type, cacheControl: '3600' },
      onBeforeRequest: async request => {
        const { data: { session: current }, error } = await client.auth.getSession();
        if (error || !current || current.user.id !== session.user.id) throw new Error('Sign in again before resuming this upload.');
        request.setHeader('authorization', `Bearer ${current.access_token}`);
        // Abort a stalled request; TUS retries and checks the server offset before continuing.
        const xhr = request.getUnderlyingObject();
        if (typeof XMLHttpRequest !== 'undefined' && xhr instanceof XMLHttpRequest) xhr.timeout = 120_000;
      },
      onProgress: (sent, total) => { percent = total ? Math.min(100, sent / total * 100) : 0; report('uploading'); },
      onShouldRetry: error => {
        const status = error.originalResponse?.getStatus() ?? 0;
        const retry = !options.signal?.aborted && (status === 0 || [408, 409, 423, 429].includes(status) || status >= 500);
        if (retry) report('retrying');
        return retry;
      },
      onError: error => finish(uploadError(error)),
      onSuccess: () => finish(),
    });
    const pause = () => { void upload.abort(false).then(() => finish(new DOMException('Upload paused. Resume to continue.', 'AbortError')), finish); };
    options.signal?.addEventListener('abort', pause, { once: true });
    void (async () => {
      try {
        if (options.signal?.aborted) { await pause(); return; }
        const previous = (await upload.findPreviousUploads()).find(item => {
          const previousPath = item.metadata.objectName;
          return item.size === file.size && item.metadata.bucketName === 'portal-private' &&
            previousPath?.startsWith(`${workspace}/`) && item.uploadUrl?.startsWith(`${endpoint}/`) &&
            Date.now() - Date.parse(item.creationTime) < 23 * 60 * 60 * 1000;
        });
        if (options.signal?.aborted) return;
        if (previous) {
          objectPath = previous.metadata.objectName;
          upload.options.metadata!.objectName = objectPath;
          upload.resumeFromPreviousUpload(previous);
        }
        upload.start();
      } catch (error) { finish(error as Error); }
    })();
  });
  options.onProgress?.({ percent: 100, phase: 'saving' });
  return objectPath;
}
