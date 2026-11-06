import { expect, test } from "@playwright/test";
import { canDismissUploads } from "~/utils/media/upload";
import type { MediaUpload } from "~/types/upload";

test("dismissing a batch never discards an unfinished or retryable upload", () => {
  const upload = (status: MediaUpload["status"]): MediaUpload => ({
    id: status,
    blockUid: status,
    fileName: `${status}.png`,
    file: new File(["test"], `${status}.png`),
    status,
  });
  const added = upload("added");
  expect(canDismissUploads({ uploads: [added], busy: false })).toBe(true);
  expect(canDismissUploads({ uploads: [], busy: false })).toBe(false);
  expect(canDismissUploads({ uploads: [added], busy: true })).toBe(false);
  for (const status of ["queued", "uploading", "linking", "failed"] as const) {
    expect(
      canDismissUploads({ uploads: [added, upload(status)], busy: false }),
    ).toBe(false);
  }
});
