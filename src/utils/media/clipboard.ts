export type MediaCopyResult =
  | { status: "copied"; file: File; convertedToPng: boolean }
  | {
      status: "download-started";
      file: File;
      reason:
        | "unsupported-format"
        | "clipboard-unavailable"
        | "clipboard-failed";
    };

const PNG_MIME_TYPE = "image/png";
const CONVERTIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/bmp",
]);

const normalizeMimeType = (mimeType: string): string =>
  mimeType.split(";")[0].trim().toLowerCase();

export const canCopyImage = (mimeType: string): boolean => {
  const type = normalizeMimeType(mimeType);
  return type === PNG_MIME_TYPE || CONVERTIBLE_IMAGE_TYPES.has(type);
};

const convertImageToPng = async (file: File): Promise<Blob> => {
  const mimeType = normalizeMimeType(file.type);
  if (mimeType === PNG_MIME_TYPE) {
    return file;
  }
  // GIF, WebP and AVIF may be animated; rasterizing them would silently lose frames.
  if (!CONVERTIBLE_IMAGE_TYPES.has(mimeType)) {
    throw new Error("This file must be downloaded in its original format.");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image conversion is unavailable in this browser.");
    }
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(
            new Error("The image could not be converted for the clipboard."),
          );
        }
      }, PNG_MIME_TYPE);
    });
  } finally {
    image.close();
  }
};

export const downloadMediaFile = ({
  file,
  fileName,
}: {
  file: File;
  fileName?: string;
}): void => {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(file);
  link.href = objectUrl;
  link.download = fileName || file.name || "media-file";
  link.hidden = true;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start reading the blob before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
};

export const copyMediaFileWithFallback = async ({
  loadFile,
  fileName,
  mimeType,
}: {
  loadFile: () => Promise<File>;
  fileName: string;
  mimeType: string;
}): Promise<MediaCopyResult> => {
  const hintedMimeType = normalizeMimeType(mimeType);
  const filePromise = loadFile();
  let reason: Extract<
    MediaCopyResult,
    { status: "download-started" }
  >["reason"] = "unsupported-format";

  if (canCopyImage(hintedMimeType)) {
    reason = "clipboard-unavailable";
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.clipboard?.write === "function" &&
      typeof ClipboardItem !== "undefined" &&
      (typeof ClipboardItem.supports !== "function" ||
        ClipboardItem.supports(PNG_MIME_TYPE))
    ) {
      reason = "clipboard-failed";
      const clipboardData = filePromise.then(convertImageToPng);
      // Some browsers reject write() before they consume the promised data.
      void clipboardData.catch(() => undefined);
      try {
        // Start write synchronously in the click handler to retain Safari activation.
        await navigator.clipboard.write([
          new ClipboardItem({ [PNG_MIME_TYPE]: clipboardData }),
        ]);
        const file = await filePromise;
        return {
          status: "copied",
          file,
          convertedToPng: normalizeMimeType(file.type) !== PNG_MIME_TYPE,
        };
      } catch {
        // A failed or denied clipboard write still permits saving the original file.
      }
    }
  }

  const file = await filePromise;
  downloadMediaFile({ file, fileName });
  return { status: "download-started", file, reason };
};
