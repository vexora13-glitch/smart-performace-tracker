import { useEffect, useState } from 'react';
import type { PortalFile } from '../../types/portal';
import { ChapterPlayer } from './chapter-player';
import type { Chapter } from './video-chapters';
import { fileUrl, loadChapters } from './video-service';

export default function ClientVideo({ file, url, onClose }: { file: PortalFile; url: string; onClose?: () => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [error, setError] = useState('');
  const [source, setSource] = useState({ url, key: 0, resumeAt: 0 });
  useEffect(() => {
    const controller = new AbortController();
    loadChapters(file, false, controller.signal).then(data => {
      if (!controller.signal.aborted) setChapters(data.chapters);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Chapter navigation is temporarily unavailable.');
    });
    return () => controller.abort();
  }, [file]);
  async function reload(seconds: number) {
    try {
      const next = await fileUrl(file);
      setError('');
      setSource(previous => ({ url: next, key: previous.key + 1, resumeAt: seconds }));
    } catch {
      setError('The video link could not be refreshed.');
    }
  }
  return <>
    <ChapterPlayer key={source.key} playback={{ url: source.url, chapters, title: file.name }}
      onRetry={reload} resumeAt={source.resumeAt} autoPlay={source.key === 0} onClose={onClose} />
    {error && <p role="status">{error}</p>}
  </>;
}
