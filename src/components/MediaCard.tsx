import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Icon,
  Menu,
  MenuItem,
  Popover,
  Position,
  type IconName,
} from "@blueprintjs/core";

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
  ["image/png", "image/jpeg", "image/jpg", "image/bmp"].includes(
    item.mimeType.split(";")[0].trim().toLowerCase(),
  );

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
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
  } = useMediaPreviewSource(
    isImage && visible ? safeUrl : null,
    previewRevision,
  );
  const previewFailed = failedUrl === item.url || !safeUrl || sourceFailed;
  const metadata = [getMediaTypeLabel(item), formatMediaSize(item.sizeBytes)]
    .filter(Boolean)
    .join(" · ");
  const similarityLabel = formatSimilarityScore(similarityScore);

  return (
    <article ref={cardRef} className="roamjs-media-gallery-card">
      <div className="roamjs-media-gallery-thumbnail-wrap">
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
              key={previewRevision}
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
        {isImage && previewFailed && safeUrl ? (
          <Button
            className="roamjs-media-gallery-retry-preview"
            small
            icon="refresh"
            text="Retry"
            aria-label={`Retry preview for ${item.fileName}`}
            onClick={() => {
              setFailedUrl(null);
              setPreviewRevision((value) => value + 1);
            }}
          />
        ) : null}
      </div>
      <div className="roamjs-media-gallery-card-content">
        <h3 className="roamjs-media-gallery-filename" title={item.fileName}>
          {item.fileName}
        </h3>
        <p className="roamjs-media-gallery-meta">{metadata}</p>
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
          <Popover
            shouldReturnFocusOnClose
            isOpen={menuOpen}
            onInteraction={(open, event) => {
              if ((event as React.KeyboardEvent | undefined)?.key === "Escape")
                event?.stopPropagation();
              setMenuOpen(open);
            }}
            usePortal={false}
            position={Position.TOP_RIGHT}
            content={
              <Menu aria-label={`More actions for ${item.fileName}`}>
                <MenuItem
                  icon="link"
                  text="Copy link"
                  onClick={() => onCopyUrl(item)}
                />
                {canCopyMediaImage(item) && safeUrl ? (
                  <MenuItem
                    icon="duplicate"
                    text={copying ? "Copying…" : "Copy image"}
                    disabled={copying}
                    onClick={() => onCopyFile(item)}
                  />
                ) : null}
                <MenuItem
                  icon="download"
                  text={downloading ? "Downloading…" : "Download"}
                  disabled={!safeUrl || downloading}
                  onClick={() => onDownload(item)}
                />
              </Menu>
            }
          >
            <Button
              small
              minimal
              text="More"
              rightIcon="more"
              aria-label={`More actions for ${item.fileName}`}
            />
          </Popover>
        </div>
      </div>
    </article>
  );
};

export default MediaCard;
