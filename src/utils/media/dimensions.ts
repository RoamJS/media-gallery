import {
  isEncryptedRoamMedia,
  resolveMediaPreviewSource,
} from "~/utils/media/source";

import type { MediaItem } from "~/types/media";
import { inferOrientation } from "~/utils/media/url";

export type MediaDimensions = {
  width: number;
  height: number;
};

export type MediaDimensionUpdate = MediaDimensions & { url: string };

export type MediaDimensionProgress = {
  completed: number;
  total: number;
  failed: number;
};

export type MediaDimensionResult = {
  items: MediaItem[];
  measured: number;
  failed: number;
  failedUrls: string[];
};

export type MediaDimensionLoader = (args: {
  url: string;
  signal?: AbortSignal;
  timeoutMs: number;
}) => Promise<MediaDimensions>;

export type MediaDimensionCache = {
  apply: (items: MediaItem[]) => MediaItem[];
  remember: (update: MediaDimensionUpdate) => void;
  clearFailures: () => void;
  measure: (args: {
    items: MediaItem[];
    signal?: AbortSignal;
    onProgress?: (progress: MediaDimensionProgress) => void;
    onDimensions?: (update: MediaDimensionUpdate) => void;
  }) => Promise<MediaDimensionResult>;
};

const abortError = (): DOMException =>
  new DOMException("Image measurement was cancelled.", "AbortError");

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw abortError();
  }
};

const validDimensions = (dimensions: {
  width: number | null;
  height: number | null;
}): dimensions is MediaDimensions =>
  typeof dimensions.width === "number" &&
  typeof dimensions.height === "number" &&
  Number.isFinite(dimensions.width) &&
  Number.isFinite(dimensions.height) &&
  dimensions.width > 0 &&
  dimensions.height > 0;

export const loadImageDimensions: MediaDimensionLoader = ({
  url,
  signal,
  timeoutMs,
}) =>
  new Promise<MediaDimensions>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const image = new Image();
    let settled = false;
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: MediaDimensions | Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      release?.();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const onAbort = (): void => finish(abortError());
    image.onload = (): void => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      finish(
        validDimensions(dimensions)
          ? dimensions
          : new Error("This image has no readable dimensions."),
      );
    };
    image.onerror = (): void =>
      finish(new Error("This image could not be loaded for measurement."));
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      () => finish(new Error("Image measurement timed out.")),
      timeoutMs,
    );
    // Natural dimensions do not require canvas pixel access or a CORS-enabled host.
    if (!isEncryptedRoamMedia(url)) {
      image.src = url;
      return;
    }
    void resolveMediaPreviewSource(url)
      .then((source) => {
        if (settled) {
          source.release();
          return;
        }
        release = source.release;
        image.src = source.url;
      })
      .catch((error: unknown) =>
        finish(
          error instanceof Error
            ? error
            : new Error("Could not retrieve the image."),
        ),
      );
  });

const applyDimensions = ({
  item,
  dimensions,
}: {
  item: MediaItem;
  dimensions?: MediaDimensions;
}): MediaItem => {
  if (!dimensions) {
    return item;
  }
  const orientation = inferOrientation(dimensions);
  if (
    item.width === dimensions.width &&
    item.height === dimensions.height &&
    item.orientation === orientation
  ) {
    return item;
  }
  return { ...item, ...dimensions, orientation };
};

const positiveInteger = ({
  value,
  fallback,
}: {
  value: number;
  fallback: number;
}): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) || 1 : fallback;

export const createMediaDimensionCache = ({
  loadDimensions = loadImageDimensions,
  concurrency = 4,
  timeoutMs = 15_000,
  maxEntries = 2_000,
}: {
  loadDimensions?: MediaDimensionLoader;
  concurrency?: number;
  timeoutMs?: number;
  maxEntries?: number;
} = {}): MediaDimensionCache => {
  const dimensionsByUrl = new Map<string, MediaDimensions>();
  const failures = new Set<string>();
  const maximumEntries = positiveInteger({
    value: maxEntries,
    fallback: 2_000,
  });
  const workerCount = positiveInteger({ value: concurrency, fallback: 4 });
  const timeout = positiveInteger({ value: timeoutMs, fallback: 15_000 });

  const remember = ({ url, width, height }: MediaDimensionUpdate): void => {
    if (!url || !validDimensions({ width, height })) {
      return;
    }
    failures.delete(url);
    dimensionsByUrl.delete(url);
    dimensionsByUrl.set(url, { width, height });
    while (dimensionsByUrl.size > maximumEntries) {
      const oldestUrl = dimensionsByUrl.keys().next().value;
      if (oldestUrl === undefined) {
        break;
      }
      dimensionsByUrl.delete(oldestUrl);
    }
  };

  const apply = (items: MediaItem[]): MediaItem[] =>
    items.map((item) => {
      if (validDimensions(item)) {
        remember({ url: item.url, width: item.width, height: item.height });
        return applyDimensions({ item, dimensions: item });
      }
      const dimensions = dimensionsByUrl.get(item.url);
      if (dimensions) {
        remember({ url: item.url, ...dimensions });
      }
      return applyDimensions({ item, dimensions });
    });

  const measure: MediaDimensionCache["measure"] = async ({
    items,
    signal,
    onProgress,
    onDimensions,
  }): Promise<MediaDimensionResult> => {
    throwIfAborted(signal);
    const mergedItems = apply(items);
    const candidates = Array.from(
      new Set(
        mergedItems
          .filter(
            (item) =>
              (item.mediaType === "image" || item.mediaType === "gif") &&
              !validDimensions(item) &&
              !failures.has(item.url),
          )
          .map((item) => item.url),
      ),
    );
    const measuredDimensions = new Map<string, MediaDimensions>();
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const progress = (): void =>
      onProgress?.({ completed, total: candidates.length, failed });
    progress();

    const run = async (): Promise<void> => {
      while (cursor < candidates.length) {
        throwIfAborted(signal);
        const url = candidates[cursor++];
        try {
          const dimensions = await loadDimensions({
            url,
            signal,
            timeoutMs: timeout,
          });
          throwIfAborted(signal);
          if (!validDimensions(dimensions)) {
            throw new Error("This image has no readable dimensions.");
          }
          remember({ url, ...dimensions });
          measuredDimensions.set(url, dimensions);
          onDimensions?.({ url, ...dimensions });
        } catch (error) {
          throwIfAborted(signal);
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }
          failures.add(url);
          failed += 1;
        }
        completed += 1;
        progress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(workerCount, candidates.length) }, run),
    );
    throwIfAborted(signal);
    const failedUrls = Array.from(
      new Set(
        mergedItems
          .filter((item) => failures.has(item.url))
          .map((item) => item.url),
      ),
    );
    return {
      items: mergedItems.map((item) =>
        applyDimensions({
          item,
          dimensions: measuredDimensions.get(item.url),
        }),
      ),
      measured: measuredDimensions.size,
      failed: failedUrls.length,
      failedUrls,
    };
  };

  return {
    apply,
    remember,
    // Retain failures during rendering; Refresh or an explicit retry can clear them.
    clearFailures: (): void => failures.clear(),
    measure,
  };
};
