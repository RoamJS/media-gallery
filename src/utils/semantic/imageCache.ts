export type CachedSemanticImage = {
  blob: Blob;
  contentHash: string;
};

type SemanticImageCache = {
  readonly size: number;
  readonly sizeBytes: number;
  get: (options: {
    url: string;
    contentHash: string;
  }) => CachedSemanticImage | undefined;
  set: (options: { url: string; image: CachedSemanticImage }) => void;
  delete: (url: string) => void;
  clear: () => void;
};

export const createSemanticImageCache = ({
  maxBytes = 16 * 1024 * 1024,
  maxEntries = 8,
}: {
  maxBytes?: number;
  maxEntries?: number;
} = {}): SemanticImageCache => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Image cache byte limit must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Image cache entry limit must be a positive integer.");
  }

  const images = new Map<string, CachedSemanticImage>();
  let sizeBytes = 0;

  const deleteImage = (url: string): void => {
    const existing = images.get(url);
    if (existing) {
      sizeBytes -= existing.blob.size;
      images.delete(url);
    }
  };

  return {
    get size() {
      return images.size;
    },
    get sizeBytes() {
      return sizeBytes;
    },
    get: ({ url, contentHash }) => {
      const image = images.get(url);
      if (!image || image.contentHash !== contentHash) {
        return undefined;
      }
      images.delete(url);
      images.set(url, image);
      return image;
    },
    set: ({ url, image }): void => {
      deleteImage(url);
      if (image.blob.size > maxBytes) {
        return;
      }
      while (
        images.size >= maxEntries ||
        sizeBytes + image.blob.size > maxBytes
      ) {
        const oldestUrl = images.keys().next().value as string;
        deleteImage(oldestUrl);
      }
      images.set(url, image);
      sizeBytes += image.blob.size;
    },
    delete: deleteImage,
    clear: (): void => {
      images.clear();
      sizeBytes = 0;
    },
  };
};
