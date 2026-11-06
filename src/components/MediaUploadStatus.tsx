import React, { useState } from "react";
import { Button, Spinner } from "@blueprintjs/core";
import { canDismissUploads } from "~/utils/media/upload";
import type { MediaUpload } from "~/types/upload";

type Props = {
  uploads: MediaUpload[];
  busy: boolean;
  destination: string;
  onRetry: () => void;
  onCopyUploadedUrl: (upload: MediaUpload) => void;
  onDismiss: () => void;
};
const MediaUploadStatus = ({
  uploads,
  busy,
  destination,
  onRetry,
  onCopyUploadedUrl,
  onDismiss,
}: Props): React.ReactElement | null => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!uploads.length) return null;
  const added = uploads.filter((u) => u.status === "added").length;
  const failed = uploads.filter((u) => u.status === "failed").length;
  const active = uploads.find(
    (u) => u.status === "uploading" || u.status === "linking",
  );
  return (
    <section
      className="roamjs-media-gallery-upload-status"
      aria-label="Upload status"
    >
      <div className="roamjs-media-gallery-upload-heading">
        <span role="status" aria-live="polite">
          {busy ? <Spinner size={14} /> : null}
          {busy
            ? `${active?.status === "linking" ? "Adding reference" : "Uploading"}: ${active?.fileName || "updating results"}`
            : `${added} file${added === 1 ? "" : "s"} added`}
          {busy ? ` · ${added} added` : ""}
          {failed ? ` · ${failed} failed` : ""}
        </span>
        <div className="roamjs-media-gallery-upload-controls">
          <Button
            minimal
            text="Details"
            aria-expanded={detailsOpen}
            aria-controls="media-gallery-upload-details"
            onClick={() => setDetailsOpen((open) => !open)}
          />
          {failed ? (
            <Button
              text="Retry failed files"
              icon="refresh"
              disabled={busy}
              onClick={onRetry}
            />
          ) : null}
          {canDismissUploads({ uploads, busy }) ? (
            <Button
              minimal
              icon="small-cross"
              aria-label="Dismiss completed uploads"
              onClick={onDismiss}
            />
          ) : null}
        </div>
      </div>
      <div id="media-gallery-upload-details" hidden={!detailsOpen}>
        <ul>
          <li>Add to: {destination}</li>
          {uploads.map((upload) => (
            <li key={upload.id}>
              <div className="roamjs-media-gallery-upload-file">
                <strong>{upload.fileName}</strong>
                <span>
                  {
                    {
                      queued: "Queued",
                      uploading: "Uploading file…",
                      linking: "Creating reference…",
                      added: "Reference added",
                      failed: upload.url
                        ? "File uploaded; reference needs retry"
                        : "Upload failed",
                    }[upload.status]
                  }
                </span>
              </div>
              {upload.error ? (
                <p role="note">
                  {upload.error}
                  {upload.url ? " Retry uses the uploaded file." : ""}
                </p>
              ) : null}
              {upload.url && upload.status === "failed" ? (
                <Button
                  minimal
                  text="Copy uploaded file URL"
                  onClick={() => onCopyUploadedUrl(upload)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {busy ? (
        <p className="roamjs-media-gallery-hint">
          Keep the gallery open while these files are added.
        </p>
      ) : null}
    </section>
  );
};
export default MediaUploadStatus;
