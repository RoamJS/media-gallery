import {
  PendingUploadReference,
  uploadFileAndCreateReference,
} from "~/utils/media/roam";

type UploadRequest = {
  file: File;
  fileName: string;
  parentUid?: string | null;
};
export type UploadOutcome = {
  id: number;
  fileName: string;
  status: "Waiting" | "Uploading" | "Saved" | "Upload failed";
  retry?: UploadRequest;
  message?: string;
};

export class UploadBatch extends EventTarget {
  outcomes: UploadOutcome[] = [];
  busy = false;
  private nextId = 0;

  async run(
    requests: UploadRequest[],
    onPending: (item: PendingUploadReference) => void,
    retry?: UploadOutcome,
  ): Promise<void> {
    if (this.busy || !requests.length) return;
    this.busy = true;
    const rows = requests.map(
      ({ fileName }) =>
        retry ?? { id: ++this.nextId, fileName, status: "Waiting" as const },
    );
    if (!retry)
      this.outcomes = [...this.outcomes.filter((row) => row.retry), ...rows];
    const saved: string[] = [];
    try {
      for (const [index, request] of requests.entries()) {
        const row: UploadOutcome = rows[index];
        row.status = "Uploading";
        row.retry = undefined;
        row.message = undefined;
        this.dispatchEvent(new Event("change"));
        try {
          saved.push(await uploadFileAndCreateReference(request));
          row.status = "Saved";
        } catch (error) {
          if (error instanceof PendingUploadReference) {
            this.outcomes = this.outcomes.filter((current) => current !== row);
            onPending(error);
          } else {
            row.status = "Upload failed";
            row.retry = request;
            row.message = error instanceof Error ? error.message : undefined;
          }
        }
        this.dispatchEvent(new Event("change"));
      }
    } finally {
      this.busy = false;
      this.dispatchEvent(new Event("change"));
      if (saved.length)
        this.dispatchEvent(new CustomEvent("saved", { detail: saved }));
    }
  }
}
