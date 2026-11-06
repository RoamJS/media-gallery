import type { MediaUpload } from "~/types/upload";

type UploadBatchOptions = {
  uploads: MediaUpload[];
  upload: (item: MediaUpload) => Promise<string>;
  link: (item: MediaUpload) => Promise<void>;
  onChange: (uploads: MediaUpload[]) => void;
};

// Keep the uploaded URL and preallocated block UID on failure: retries resume
// reference creation rather than re-uploading a successful file or duplicating its block.
export const runUploadBatch = async ({
  uploads,
  upload,
  link,
  onChange,
}: UploadBatchOptions): Promise<MediaUpload[]> => {
  const results = uploads.map((item) => ({ ...item }));
  const notify = (): void => onChange(results.map((item) => ({ ...item })));
  for (const item of results) {
    if (item.status === "added") continue;
    item.error = undefined;
    try {
      if (!item.url) {
        item.status = "uploading";
        notify();
        item.url = await upload(item);
      }
      item.status = "linking";
      notify();
      await link(item);
      item.status = "added";
    } catch (error) {
      item.status = "failed";
      item.error =
        error instanceof Error
          ? error.message
          : "This file could not be added. Try again.";
    }
    notify();
  }
  return results;
};
