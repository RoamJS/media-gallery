import React, { useEffect, useRef, useState } from "react";
import { Button, Icon, type IconName } from "@blueprintjs/core";

import { canCopyImage } from "~/utils/media/clipboard";
import { getSafeMediaUrl } from "~/utils/media/url";
import useMediaPreviewSource from "~/components/useMediaPreviewSource";

import type { MediaItem } from "~/types/media";
import { formatSimilarityScore } from "~/utils/semantic/score";

export type MediaAction = (item: MediaItem) => void;

export type MediaCardProps = {
  item: MediaItem;
  copying?: boolean;
  downloading?: boolean;
  similarityScore?: number;
  onPreview: MediaAction;
  onOpenSource: MediaAction;
  onCopyUrl: MediaAction;
  onCopyFile: MediaAction;
  onDownload: MediaAction;
  onImageLoad?: (args: { itemId: string; image: HTMLImageElement }) => void;
};

export { getSafeMediaUrl } from "~/utils/media/url";

export const canCopyMediaImage = (item: MediaItem): boolean =>
  canCopyImage(item.mimeType);

export const formatMediaSize = (bytes: number | null): string | null => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getMediaTypeLabel = (item: MediaItem): string => {
  if (item.mediaType === "gif" || item.mediaType === "pdf") {
    return item.mediaType.toUpperCase();
  }
  if (item.mediaType === "other") {
    return item.extension ? item.extension.toUpperCase() : "File";
  }
  return `${item.mediaType.charAt(0).toUpperCase()}${item.mediaType.slice(1)}`;
};

export const getMediaTypeIcon = (item: MediaItem): IconName => {
  if (item.mediaType === "image" || item.mediaType === "gif") {
    return "media";
  }
  if (item.mediaType === "audio") {
    return "volume-up";
  }
  return item.mediaType === "video" ? "video" : "document";
};

const getReadableAuthor = (authors: string[]): string | undefined =>
  authors.find(
    (author) =>
      Boolean(author.trim()) &&
      author.toLowerCase() !== "unknown" &&
      !/^[a-z0-9_-]{20,}$/i.test(author) &&
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(author),
  );

const MediaCard = ({
  item,
  copying = false,
  downloading = false,
  similarityScore,
  onPreview,
  onOpenSource,
  onCopyUrl,
  onCopyFile,
  onDownload,
  onImageLoad,
}: MediaCardProps): React.ReactElement => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const safeUrl = getSafeMediaUrl(item.url);
  const isImage = item.mediaType === "image" || item.mediaType === "gif";
  const cardRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const {
    url: previewUrl,
    loading: previewLoading,
    failed: sourceFailed,
  } = useMediaPreviewSource(isImage && visible ? safeUrl : null);
  const previewFailed = failedUrl === item.url || !safeUrl || sourceFailed;
  const metadata = [
    getMediaTypeLabel(item),
    formatMediaSize(item.sizeBytes),
    item.width && item.height ? `${item.width} × ${item.height}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const author = getReadableAuthor(item.authors);
  const referenceCount = new Set(
    item.references.map(({ blockUid }) => blockUid),
  ).size;
  const similarityLabel = formatSimilarityScore(similarityScore);

  return (
    <article ref={cardRef} className="roamjs-media-gallery-card">
      <Button
        minimal
        fill
        className="roamjs-media-gallery-thumbnail"
        aria-label={`Preview ${item.fileName}`}
        onClick={(event: React.MouseEvent<HTMLElement>) => {
          event.currentTarget.focus();
          onPreview(item);
        }}
      >
        {isImage && !previewFailed && previewUrl ? (
          <img
            src={previewUrl || undefined}
            alt=""
            className="roamjs-media-gallery-thumbnail-image"
            loading="lazy"
            decoding="async"
            onLoad={(event) =>
              onImageLoad?.({ itemId: item.id, image: event.currentTarget })
            }
            onError={() => setFailedUrl(item.url)}
          />
        ) : (
          <span className="roamjs-media-gallery-file-placeholder">
            <Icon icon={getMediaTypeIcon(item)} iconSize={28} />
            <span>
              {isImage
                ? previewLoading
                  ? "Loading preview…"
                  : "Preview unavailable"
                : getMediaTypeLabel(item)}
            </span>
            <span className="roamjs-media-gallery-file-placeholder-hint">
              {isImage ? "View details" : "Open preview"}
            </span>
          </span>
        )}
        {similarityLabel ? (
          <span
            className="roamjs-media-gallery-similarity-badge"
            title="Cosine similarity on a −100% to 100% scale; not match confidence."
          >
            {similarityLabel} similarity
          </span>
        ) : null}
      </Button>
      <div className="roamjs-media-gallery-card-content">
        <h3 className="roamjs-media-gallery-filename" title={item.fileName}>
          {item.fileName}
        </h3>
        <p className="roamjs-media-gallery-meta">{metadata}</p>
        {referenceCount || author ? (
          <p
            className="roamjs-media-gallery-meta"
            title={
              author
                ? `Roam block creator or last editor: ${author}`
                : undefined
            }
          >
            {[
              referenceCount
                ? `${referenceCount} reference${referenceCount === 1 ? "" : "s"}`
                : null,
              author,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <div
          className="roamjs-media-gallery-actions"
          role="group"
          aria-label={`Actions for ${item.fileName}`}
        >
          {item.references.length ? (
            <Button
              small
              minimal
              icon="document-open"
              text="Source"
              aria-label={`Open source for ${item.fileName}`}
              onClick={() => onOpenSource(item)}
            />
          ) : null}
          <Button
            small
            minimal
            icon="link"
            aria-label={`Copy URL for ${item.fileName}`}
            title="Copy URL"
            onClick={() => onCopyUrl(item)}
          />
          {canCopyMediaImage(item) && safeUrl ? (
            <Button
              small
              minimal
              icon="duplicate"
              aria-label={`Copy image ${item.fileName}`}
              title="Copy image"
              loading={copying}
              onClick={() => onCopyFile(item)}
            />
          ) : null}
          <Button
            small
            minimal
            icon="download"
            aria-label={`Download ${item.fileName}`}
            title="Download original file"
            loading={downloading}
            disabled={!safeUrl}
            onClick={() => onDownload(item)}
          />
        </div>
      </div>
    </article>
  );
};

export default MediaCard;
