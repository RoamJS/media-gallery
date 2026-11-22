import React, { useEffect, useState } from "react";
import { Button, Callout } from "@blueprintjs/core";
import {
  copyTextToClipboard,
  type PendingUploadReference,
} from "~/utils/media/roam";

// Owned by the extension so closing the gallery while a write is pending keeps its recovery actions.
export class UploadRecoveryQueue extends EventTarget {
  readonly pending = new Set<PendingUploadReference>();
  readonly retrying = new Set<PendingUploadReference>();
  add(item: PendingUploadReference): void {
    this.pending.add(item);
    this.dispatchEvent(new Event("change"));
  }
  async retry(item: PendingUploadReference): Promise<boolean> {
    if (!this.pending.has(item) || this.retrying.has(item)) return false;
    this.retrying.add(item);
    this.dispatchEvent(new Event("change"));
    try {
      await item.retry();
      this.pending.delete(item);
      return true;
    } finally {
      this.retrying.delete(item);
      this.dispatchEvent(new Event("change"));
    }
  }
}

export const UploadRecovery = ({
  queue,
  onRecovered,
}: {
  queue: UploadRecoveryQueue;
  onRecovered: (url: string) => void;
}): React.ReactElement | null => {
  const [, redraw] = useState(0);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const update = (): void => redraw((n) => n + 1);
    queue.addEventListener("change", update);
    update();
    return () => queue.removeEventListener("change", update);
  }, [queue]);
  if (!queue.pending.size) return null;
  return (
    <Callout title="Uploaded files awaiting a reference" intent="warning">
      <p>
        Retry adds the link at the original destination, or on Media Gallery
        Uploads if that destination was deleted.
      </p>
      {Array.from(queue.pending, (item) => (
        <div key={item.reference.blockUid}>
          <strong>{item.reference.fileName}</strong>{" "}
          <Button
            small
            text="Retry reference"
            disabled={queue.retrying.has(item)}
            onClick={async () => {
              try {
                if (await queue.retry(item)) onRecovered(item.reference.url);
              } catch (error) {
                setFeedback(
                  error instanceof Error
                    ? error.message
                    : "Could not save the reference.",
                );
              }
            }}
          />
          <Button
            small
            minimal
            text="Copy file URL"
            onClick={async () => {
              try {
                await copyTextToClipboard({ text: item.reference.url });
                setFeedback("File URL copied.");
              } catch {
                setFeedback(
                  "Copy failed. Select the file URL to copy it manually.",
                );
              }
            }}
          />
          <input
            readOnly
            aria-label={`Uploaded file URL for ${item.reference.fileName}`}
            value={item.reference.url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ))}
      <span role="status">{feedback}</span>
    </Callout>
  );
};
