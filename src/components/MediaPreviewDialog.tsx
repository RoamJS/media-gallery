import React, { useEffect, useState } from "react";
import { AnchorButton, Button, Dialog, Icon } from "@blueprintjs/core";

import {
  canCopyMediaImage,
  formatMediaSize,
  getMediaTypeIcon,
  getMediaTypeLabel,
  getSafeMediaUrl,
  type MediaAction,
} from "~/components/MediaCard";
import type { MediaItem } from "~/types/media";

export type MediaPreviewDialogProps = {
  item: MediaItem | null;
  isOpen: boolean;
  onClose: () => void;
  onClosed?: () => void;
  copying?: boolean;
  downloading?: boolean;
  onOpenSource: MediaAction;
  onCopyUrl: MediaAction;
  onOpenReferences: MediaAction;
  onCopyMarkdown: MediaAction;
  onCopyFile: MediaAction;
  onDownload: MediaAction;
};

const MediaPreviewDialog = ({
  item,
  isOpen,
  onClose,
  onClosed,
  copying = false,
  downloading = false,
  onOpenSource,
  onCopyUrl,
  onOpenReferences,
  onCopyMarkdown,
  onCopyFile,
  onDownload,
}: MediaPreviewDialogProps): React.ReactElement | null => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      setFailedUrl(null);
    }
  }, [isOpen, item?.url]);
  if (!item) {
    return null;
  }
  const safeUrl = getSafeMediaUrl(item.url);
  const previewFailed = failedUrl === item.url || !safeUrl;
  const isImage = item.mediaType === "image" || item.mediaType === "gif";
  const canPreview =
    isImage || item.mediaType === "video" || item.mediaType === "audio";
  const size = formatMediaSize(item.sizeBytes);
  const referenceCount = new Set(
    item.references.map(({ blockUid }) => blockUid),
  ).size;
  const handleClose = (event?: React.SyntheticEvent<HTMLElement>): void => {
    event?.stopPropagation();
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      title={item.fileName}
      icon={getMediaTypeIcon(item)}
      onClose={handleClose}
      onClosed={onClosed}
      autoFocus
      enforceFocus
      shouldReturnFocusOnClose
      canEscapeKeyClose
      className="roamjs-media-gallery-preview-dialog"
    >
      <div className="bp3-dialog-body roamjs-media-gallery-preview-body">
        <div className="roamjs-media-gallery-preview-stage">
          {safeUrl && !previewFailed && isImage ? (
            <img
              className="roamjs-media-gallery-full-image"
              src={safeUrl}
              alt={item.fileName}
              onError={() => setFailedUrl(item.url)}
            />
          ) : safeUrl && !previewFailed && item.mediaType === "video" ? (
            <video
              className="roamjs-media-gallery-full-video"
              src={safeUrl}
              controls
              preload="metadata"
              aria-label={item.fileName}
              onError={() => setFailedUrl(item.url)}
            />
          ) : safeUrl && !previewFailed && item.mediaType === "audio" ? (
            <div className="roamjs-media-gallery-audio-preview">
              <Icon icon="volume-up" iconSize={40} />
              <audio
                src={safeUrl}
                controls
                preload="metadata"
                aria-label={item.fileName}
                onError={() => setFailedUrl(item.url)}
              />
            </div>
          ) : (
            <div className="roamjs-media-gallery-preview-placeholder">
              <Icon icon={getMediaTypeIcon(item)} iconSize={40} />
              <h3>
                {previewFailed && canPreview
                  ? "Preview unavailable"
                  : getMediaTypeLabel(item)}
              </h3>
              <p>
                {!safeUrl
                  ? "This file does not have a supported web address. Open its source to inspect the reference."
                  : canPreview
                    ? "Open the original file or download it to view it in another app."
                    : "Open this file in a new tab or download the original."}
              </p>
              {safeUrl ? (
                <AnchorButton
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon="share"
                  text="Open original"
                />
              ) : null}
            </div>
          )}
        </div>
        <div className="roamjs-media-gallery-preview-details">
          <p className="roamjs-media-gallery-meta">
            {[
              getMediaTypeLabel(item),
              size,
              item.width && item.height
                ? `${item.width} × ${item.height}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {referenceCount ? " · " : null}
            {referenceCount > 1 ? (
              <button
                type="button"
                className="roamjs-media-gallery-reference-link"
                title="Open referencing blocks in Roam’s right sidebar"
                onClick={() => onOpenReferences(item)}
              >
                {referenceCount} references
              </button>
            ) : referenceCount === 1 ? (
              "1 reference"
            ) : null}
          </p>
          {item.updatedTime ? (
            <p className="roamjs-media-gallery-meta">
              Reference block updated{" "}
              {new Date(item.updatedTime).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div
          className="roamjs-media-gallery-preview-actions"
          role="group"
          aria-label="Media actions"
        >
          {item.references.length ? (
            <Button
              icon="document-open"
              text="Source"
              onClick={() => onOpenSource(item)}
            />
          ) : null}
          <Button icon="link" text="Copy URL" onClick={() => onCopyUrl(item)} />
          <Button
            icon="clipboard"
            text="Copy Markdown"
            onClick={() => onCopyMarkdown(item)}
          />
          {canCopyMediaImage(item) && safeUrl ? (
            <Button
              icon="duplicate"
              text="Copy image"
              loading={copying}
              onClick={() => onCopyFile(item)}
            />
          ) : null}
          <Button
            icon="download"
            text="Download"
            loading={downloading}
            disabled={!safeUrl}
            onClick={() => onDownload(item)}
          />
          {safeUrl && canPreview && !previewFailed ? (
            <AnchorButton
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon="share"
              text="Open original"
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
};

export default MediaPreviewDialog;
