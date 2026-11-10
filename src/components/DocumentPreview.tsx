import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = worker;

export default function DocumentPreview({ blob, name }: { blob: Blob; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(0),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  useEffect(() => {
    let active = true;
    if (blob.type === 'text/plain')
      void blob
        .slice(0, 200000)
        .text()
        .then((value) => {
          if (active)
            setText(
              value + (blob.size > 200000 ? '\n[Preview limited to the first 200,000 bytes.]' : ''),
            );
        });
    return () => {
      active = false;
    };
  }, [blob]);
  useEffect(() => {
    if (blob.type !== 'application/pdf') return;
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    let render: { cancel: () => void } | undefined;
    void (async () => {
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!active) return;
        task = getDocument({ data });
        const pdf = await task.promise;
        if (!active) return;
        setPages(pdf.numPages);
        const source = await pdf.getPage(page);
        if (!active || !canvas.current) return;
        const viewport = source.getViewport({
          scale: Math.min(1.5, 1100 / source.getViewport({ scale: 1 }).width),
        });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        const context = target.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        const rendering = source.render({ canvas: target, canvasContext: context, viewport });
        render = rendering;
        await rendering.promise;
        const content = await source.getTextContent();
        if (active) setText(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      } catch {
        if (active)
          setError('This document could not be previewed. You can download the original file.');
      }
    })();
    return () => {
      active = false;
      render?.cancel();
      void task?.destroy();
    };
  }, [blob, page]);
  return (
    <div className="document-preview">
      {error && <p role="alert">{error}</p>}
      {blob.type === 'application/pdf' ? (
        <>
          <div className="button-row">
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Previous page
            </button>
            <span>
              Page {page} of {pages || '…'}
            </span>
            <button
              className="secondary"
              disabled={!pages || page >= pages}
              onClick={() => setPage((v) => v + 1)}
            >
              Next page
            </button>
          </div>
          <canvas ref={canvas} aria-label={`${name}, page ${page}`} />
          <details>
            <summary>Page text</summary>
            <p>{text || 'No selectable text on this page.'}</p>
          </details>
        </>
      ) : blob.type.startsWith('image/') ? (
        <img src={url} alt={name} />
      ) : (
        <pre>{text}</pre>
      )}
    </div>
  );
}
