import { memo, useState } from 'react';
import { FileVideo, ImagePlus, Play } from 'lucide-react';
import { formatVideoTime } from './video-chapters';
import type { ThumbnailView } from './use-video-thumbnails';

/** 16:9 list preview. The row's own Play button stays the accessible control; this is a larger pointer target. */
export const VideoThumbnail = memo(function VideoThumbnail({
  name,
  view,
  onPlay,
  onEdit,
}: {
  name: string;
  view: ThumbnailView;
  onPlay: () => void;
  /** Admins only: renders the change-thumbnail icon under the thumbnail. */
  onEdit?: () => void;
}) {
  const [failed, setFailed] = useState<string>();
  const showImage = view.url && failed !== view.url;
  return (
    <span className="video-thumb-stack">
      <span className="video-thumb" data-state={showImage ? 'ready' : view.generating ? 'generating' : 'empty'}>
        <button type="button" className="video-thumb-media" tabIndex={-1} aria-hidden="true" onClick={onPlay}>
          {showImage ? (
            <img
              src={view.url}
              alt=""
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(view.url)}
            />
          ) : (
            <FileVideo className="video-thumb-placeholder" size={22} />
          )}
          <span className="video-thumb-play">
            <Play size={11} fill="currentColor" />
            {view.duration ? <span>{formatVideoTime(view.duration)}</span> : null}
          </span>
        </button>
        {view.generating && !showImage && <span className="sr-only">Generating thumbnail for {name}</span>}
      </span>
      {onEdit && (
        <button
          type="button"
          className="video-thumb-edit"
          aria-label={`Edit thumbnail for ${name}`}
          title="Change thumbnail"
          onClick={onEdit}
        >
          <ImagePlus size={14} />
        </button>
      )}
    </span>
  );
});
