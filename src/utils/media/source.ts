import { getFileByUrl } from "~/utils/media/roam";
import { getSafeMediaUrl, isRoamStorageUrl } from "~/utils/media/url";

export const isEncryptedRoamMedia = (url: string): boolean =>
  typeof window !== "undefined" &&
  Boolean(window.roamAlphaAPI?.graph?.isEncrypted) &&
  isRoamStorageUrl(url);

export const getDecryptedMediaBlob = async (
  url: string,
  signal?: AbortSignal,
): Promise<Blob | null> => {
  if (!isEncryptedRoamMedia(url)) return null;
  if (signal?.aborted)
    throw new DOMException("Media retrieval cancelled.", "AbortError");
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = (): void =>
      reject(new DOMException("Media retrieval cancelled.", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    void getFileByUrl({ url })
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener("abort", onAbort));
  });
};

// A decrypted blob opened as a document inherits Roam's origin (including HTML/SVG scripts).
// Keep encrypted originals in the download flow; blobs are only rendered in inert media elements.
export const getOriginalMediaSource = (url: string): string | null =>
  isEncryptedRoamMedia(url) ? null : getSafeMediaUrl(url);

export type MediaPreviewSource = { url: string; release: () => void };

const INERT_PREVIEW_TYPES = new Set([
  "image/png",
  "image/apng",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-msvideo",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/opus",
  "audio/x-m4a",
]);

export const resolveMediaPreviewSource = async (
  url: string,
): Promise<MediaPreviewSource> => {
  const blob = await getDecryptedMediaBlob(url);
  if (!blob) return { url, release: () => undefined };
  if (!INERT_PREVIEW_TYPES.has(blob.type.split(";")[0].trim().toLowerCase())) {
    throw new Error("This encrypted file format must be downloaded to view.");
  }
  const objectUrl = URL.createObjectURL(blob);
  return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
};
