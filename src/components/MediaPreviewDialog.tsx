import React, { useEffect, useState } from "react";
import {
  AnchorButton,
  Button,
  Dialog,
  Icon,
  InputGroup,
  Menu,
  MenuItem,
  Popover,
  Position,
} from "@blueprintjs/core";

import {
  canCopyMediaImage,
  formatMediaSize,
  getMediaTypeIcon,
  getMediaTypeLabel,
  getSafeMediaUrl,
  type MediaAction,
} from "~/components/MediaCard";
import { getOriginalMediaSource } from "~/utils/media/source";
import useMediaPreviewSource from "~/components/useMediaPreviewSource";

import {
  getReferenceEvents,
  formatReferenceDate,
} from "~/utils/media/presentation";
import type { MediaItem, MediaFeedback } from "~/types/media";

export type MediaPreviewDialogProps = {
  item: MediaItem | null;
  isOpen: boolean;
  onClose: () => void;
  onClosed?: () => void;
  dark?: boolean;
  feedback?: MediaFeedback | null;
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
  dark = false,
  feedback,
  copying = false,
  downloading = false,
  onOpenSource,
  onCopyUrl,
  onOpenReferences,
  onCopyMarkdown,
  onCopyFile,
  onDownload,
}: MediaPreviewDialogProps): React.ReactElement | null => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      setFailedUrl(null);
    }
  }, [isOpen, item?.url]);
  const supportsPreview = Boolean(
    item && ["image", "gif", "video", "audio"].includes(item.mediaType),
  );
  const {
    url: previewUrl,
    loading: previewLoading,
    failed: sourceFailed,
  } = useMediaPreviewSource(
    isOpen && item && supportsPreview ? getSafeMediaUrl(item.url) : null,
    previewRevision,
  );
  if (!item) {
    return null;
  }
  const safeUrl = getSafeMediaUrl(item.url);
  const originalUrl = getOriginalMediaSource(item.url);
  const previewFailed = failedUrl === item.url || !safeUrl || sourceFailed;
  const isImage = item.mediaType === "image" || item.mediaType === "gif";
  const canPreview = supportsPreview;
  const size = formatMediaSize(item.sizeBytes);
  const { first, latest, count: referenceCount } = getReferenceEvents(item);
  const references = [
    ...new Map(
      item.references.map((reference) => [reference.blockUid, reference]),
    ).values(),
  ];
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
      className={["roamjs-media-gallery-preview-dialog", dark ? "bp3-dark" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="bp3-dialog-body roamjs-media-gallery-preview-body">
        <div className="roamjs-media-gallery-preview-stage">
          {previewUrl && !previewFailed && isImage ? (
            <img
              className="roamjs-media-gallery-full-image"
              key={previewRevision}
              src={previewUrl || undefined}
              alt={item.fileName}
              onError={() => setFailedUrl(item.url)}
            />
          ) : previewUrl && !previewFailed && item.mediaType === "video" ? (
            <video
              className="roamjs-media-gallery-full-video"
              key={previewRevision}
              src={previewUrl || undefined}
              controls
              preload="metadata"
              aria-label={item.fileName}
              onError={() => setFailedUrl(item.url)}
            />
          ) : previewUrl && !previewFailed && item.mediaType === "audio" ? (
            <div className="roamjs-media-gallery-audio-preview">
              <Icon icon="volume-up" iconSize={40} />
              <audio
                key={previewRevision}
                src={previewUrl || undefined}
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
                {previewLoading
                  ? "Loading preview…"
                  : previewFailed && canPreview
                    ? "Preview unavailable"
                    : getMediaTypeLabel(item)}
              </h3>
              <p>
                {previewLoading
                  ? "Retrieving this file through Roam…"
                  : !safeUrl
                    ? "This file does not have a supported web address. Open its source to inspect the reference."
                    : !originalUrl
                      ? "Download the original file to view it in another app."
                      : canPreview
                        ? "Open the original file or download it to view it in another app."
                        : "Open this file in a new tab or download the original."}
              </p>
              {previewFailed && safeUrl && supportsPreview ? (
                <Button
                  text="Retry preview"
                  icon="refresh"
                  onClick={() => {
                    setFailedUrl(null);
                    setPreviewRevision((value) => value + 1);
                  }}
                />
              ) : null}
              {originalUrl ? (
                <AnchorButton
                  href={originalUrl || undefined}
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
          </p>
          <details className="roamjs-media-gallery-reference-details">
            <summary>
              Used in {referenceCount} block{referenceCount === 1 ? "" : "s"}
            </summary>
            <dl>
              <div>
                <dt>First block created</dt>
                <dd>
                  {formatReferenceDate(first?.createdTime ?? null)}
                  {first?.createdAuthor ? ` · ${first.createdAuthor}` : ""}
                </dd>
              </div>
              <div>
                <dt>Last block edited</dt>
                <dd>
                  {formatReferenceDate(latest?.updatedTime ?? null)}
                  {latest?.updatedAuthor ? ` · ${latest.updatedAuthor}` : ""}
                </dd>
              </div>
            </dl>
            {references.length ? (
              <>
                <Button
                  minimal
                  text={
                    references.length === 1 ? "Open block" : "Open all blocks"
                  }
                  onClick={() => onOpenReferences(item)}
                />
                {references.length > 1 ? (
                  <ul>
                    {references.slice(0, 20).map((reference, index) => (
                      <li key={reference.blockUid}>
                        <Button
                          minimal
                          text={`Block ${index + 1}`}
                          onClick={() =>
                            onOpenSource({ ...item, references: [reference] })
                          }
                        />
                        <span>
                          Created {formatReferenceDate(reference.createdTime)} ·{" "}
                          {reference.createdAuthor}; last edited{" "}
                          {formatReferenceDate(reference.updatedTime)} ·{" "}
                          {reference.updatedAuthor}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {references.length > 20 ? (
                  <p>
                    Showing the first 20 blocks. Open all referring blocks in
                    the sidebar to see the full set.
                  </p>
                ) : null}
              </>
            ) : (
              <p>No referring blocks are available in this result.</p>
            )}
          </details>
          {feedback ? (
            <div
              className={[
                "roamjs-media-gallery-feedback",
                !feedback.error && !feedback.pendingUpload
                  ? "roamjs-media-gallery-confirmation"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role={feedback.error ? "alert" : "status"}
            >
              <span>{feedback.message}</span>
              {feedback.url ? (
                <InputGroup
                  aria-label="Media URL to copy manually"
                  readOnly
                  value={feedback.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div
          className="roamjs-media-gallery-preview-actions"
          role="group"
          aria-label="Media actions"
        >
          <Popover
            isOpen={menuOpen}
            onInteraction={(open, event) => {
              if ((event as React.KeyboardEvent | undefined)?.key === "Escape")
                event?.stopPropagation();
              setMenuOpen(open);
            }}
            usePortal={false}
            position={Position.TOP_LEFT}
            content={
              <Menu aria-label="Copy formats">
                <MenuItem
                  icon="link"
                  text="Copy link"
                  onClick={() => onCopyUrl(item)}
                />
                <MenuItem
                  icon="clipboard"
                  text="Copy Markdown"
                  onClick={() => onCopyMarkdown(item)}
                />
                {canCopyMediaImage(item) && safeUrl ? (
                  <MenuItem
                    icon="duplicate"
                    text={copying ? "Copying…" : "Copy image"}
                    disabled={copying}
                    onClick={() => onCopyFile(item)}
                  />
                ) : null}
              </Menu>
            }
          >
            <Button icon="clipboard" text="Copy" rightIcon="caret-down" />
          </Popover>
          <Button
            icon="download"
            text="Download"
            loading={downloading}
            disabled={!safeUrl}
            onClick={() => onDownload(item)}
          />
          {originalUrl && canPreview && !previewFailed ? (
            <AnchorButton
              href={originalUrl || undefined}
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
