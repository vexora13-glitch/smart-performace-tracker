import { db, fileUrl, unwrap } from '../../services/portal';
import type { PortalFile } from '../../types/portal';
import type { Chapter } from './video-chapters';

const bucket = () => db().storage.from('portal-private');

export async function loadChapters(file: PortalFile, draft: boolean, signal: AbortSignal) {
  const query = db().from('portal_video_chapter_sets').select('state,chapters,revision').eq('file_id', file.id);
  if (!draft) query.eq('state', 'published');
  const result = await query.abortSignal(signal);
  // Allow existing media to play before the additive migration is applied.
  if (result.error?.code === 'PGRST205' && !draft) return { chapters: [], revision: 0, publishedRevision: 0 };
  if (result.error?.code === 'PGRST205') throw new Error('Apply the video chapters migration to use the editor.');
  const rows = unwrap(result);
  const row = rows.find(item => item.state === (draft ? 'draft' : 'published'));
  const chapters = (row?.chapters ?? []) as Chapter[];
  const paths = [...new Set(chapters.flatMap(chapter => chapter.thumbnailPath ? [chapter.thumbnailPath] : []))];
  const signed = paths.length ? (await bucket().createSignedUrls(paths, 3600)).data : [];
  const urls = new Map(signed?.map(item => [item.path, item.signedUrl]));
  return {
    chapters: chapters.map(chapter => ({ ...chapter, thumbnailUrl: urls.get(chapter.thumbnailPath ?? '') ?? undefined })),
    revision: row?.revision ?? 0,
    publishedRevision: rows.find(item => item.state === 'published')?.revision ?? 0,
  };
}

export async function saveChapters(file: PortalFile, chapters: Chapter[], revision: number, publish: boolean, duration: number | null) {
  const response = await db().rpc('portal_save_video_chapters', {
    video: file.id, expected: revision, publish, duration,
    items: chapters.map(({ id, title, description, start, end, thumbnailPath }) =>
      ({ id, title: title.trim(), description: description.trim(), start, end, thumbnailPath })),
  });
  if (response.error) throw new Error(response.error.message);
  if (typeof response.data !== 'number') throw new Error('This video changed. Reopen the editor before saving again.');
  return response.data;
}

export async function uploadChapterThumbnail(file: PortalFile, image: Blob) {
  const path = `${file.workspace_id}/video-chapters/${file.id}/${crypto.randomUUID()}.jpg`;
  unwrap(await bucket().upload(path, image, { contentType: 'image/jpeg', upsert: false }));
  const url = unwrap(await bucket().createSignedUrl(path, 3600)).signedUrl;
  return { path, url };
}

export { fileUrl };
