import { getFileByUrl } from "~/utils/media/roam";
import { isRoamStorageUrl } from "~/utils/media/url";

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

export type MediaPreviewSource = { url: string; release: () => void };

export const resolveMediaPreviewSource = async (
  url: string,
): Promise<MediaPreviewSource> => {
  const blob = await getDecryptedMediaBlob(url);
  if (!blob) return { url, release: () => undefined };
  const objectUrl = URL.createObjectURL(blob);
  return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
};
