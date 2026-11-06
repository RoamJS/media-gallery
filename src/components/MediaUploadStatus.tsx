import React from "react";
import { Button, Spinner } from "@blueprintjs/core";
import type { MediaUpload } from "~/types/upload";

type Props = {
  uploads: MediaUpload[];
  busy: boolean;
  destination: string;
  onRetry: () => void;
  onCopyUploadedUrl: (upload: MediaUpload) => void;
};
const MediaUploadStatus = ({
  uploads,
  busy,
  destination,
  onRetry,
  onCopyUploadedUrl,
}: Props): React.ReactElement | null => {
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
            : "Upload finished"}{" "}
          · {added} added{failed ? `, ${failed} failed` : ""}
        </span>
        {failed ? (
          <Button
            text="Retry failed files"
            icon="refresh"
            disabled={busy}
            onClick={onRetry}
          />
        ) : null}
      </div>
      <details>
        <summary>
          {uploads.length} file{uploads.length === 1 ? "" : "s"} · References in{" "}
          {destination}
        </summary>
        <ul>
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
      </details>
      {busy ? (
        <p className="roamjs-media-gallery-hint">
          Keep the gallery open while these files are added.
        </p>
      ) : null}
    </section>
  );
};
export default MediaUploadStatus;
