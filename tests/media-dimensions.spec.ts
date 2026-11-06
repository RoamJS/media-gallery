import { expect, test } from "@playwright/test";

import type { MediaItem } from "~/types/media";
import {
  createMediaDimensionCache,
  loadImageDimensions,
  type MediaDimensions,
} from "~/utils/media/dimensions";

const mediaItem = (url: string): MediaItem => ({
  id: url,
  url,
  fileName: url,
  extension: "png",
  searchText: url,
  mediaType: "image",
  mimeType: "image/png",
  sizeBytes: null,
  width: null,
  height: null,
  orientation: "unknown",
  createdTime: null,
  updatedTime: null,
  authors: [],
  references: [],
});

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test("measures unseen images and retains orientation through a fresh query", async () => {
  const calls: string[] = [];
  const cache = createMediaDimensionCache({
    loadDimensions: async ({ url }): Promise<MediaDimensions> => {
      calls.push(url);
      return url === "portrait"
        ? { width: 120, height: 240 }
        : { width: 400, height: 200 };
    },
  });
  const first = await cache.measure({
    items: [mediaItem("portrait"), mediaItem("landscape")],
  });
  expect(first.items.map((item) => item.orientation)).toEqual([
    "portrait",
    "landscape",
  ]);
  expect(first.measured).toBe(2);
  const refreshed = cache.apply([
    mediaItem("portrait"),
    mediaItem("landscape"),
  ]);
  expect(refreshed.map((item) => item.orientation)).toEqual([
    "portrait",
    "landscape",
  ]);
  const second = await cache.measure({ items: refreshed });
  expect(second.measured).toBe(0);
  expect(calls).toEqual(["portrait", "landscape"]);
});

test("deduplicates URLs, accepts thumbnail dimensions, and ignores non-images", async () => {
  const calls: string[] = [];
  const cache = createMediaDimensionCache({
    loadDimensions: async ({ url }): Promise<MediaDimensions> => {
      calls.push(url);
      return { width: 100, height: 100 };
    },
  });
  cache.remember({ url: "loaded", width: 80, height: 160 });
  const result = await cache.measure({
    items: [
      mediaItem("loaded"),
      mediaItem("duplicate"),
      { ...mediaItem("duplicate"), id: "second-reference", mediaType: "gif" },
      { ...mediaItem("video"), mediaType: "video" },
    ],
  });
  expect(calls).toEqual(["duplicate"]);
  expect(result.items.map((item) => item.orientation)).toEqual([
    "portrait",
    "square",
    "square",
    "unknown",
  ]);
});

test("limits image requests and returns progress for the whole candidate list", async () => {
  const releases: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  let started = 0;
  const progress: number[] = [];
  const cache = createMediaDimensionCache({
    concurrency: 2,
    loadDimensions: async (): Promise<MediaDimensions> => {
      active += 1;
      started += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { width: 100, height: 200 };
    },
  });
  const measuring = cache.measure({
    items: Array.from({ length: 5 }, (_, index) => mediaItem(String(index))),
    onProgress: ({ completed }) => progress.push(completed),
  });
  expect(started).toBe(2);
  while (started < 5 || active > 0) {
    releases.splice(0).forEach((release) => release());
    await tick();
  }
  const result = await measuring;
  expect(result.measured).toBe(5);
  expect(peak).toBe(2);
  expect(progress).toEqual([0, 1, 2, 3, 4, 5]);
});

test("abort cancels current work and never starts queued images or caches cancelled results", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  let updates = 0;
  const cache = createMediaDimensionCache({
    concurrency: 1,
    loadDimensions: ({ url, signal }): Promise<MediaDimensions> => {
      started.push(url);
      return new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      });
    },
  });
  const measuring = cache.measure({
    items: [mediaItem("active"), mediaItem("queued")],
    signal: controller.signal,
    onDimensions: () => {
      updates += 1;
    },
  });
  controller.abort();
  await expect(measuring).rejects.toMatchObject({ name: "AbortError" });
  expect(started).toEqual(["active"]);
  expect(updates).toBe(0);
  expect(cache.apply([mediaItem("active")])[0].orientation).toBe("unknown");
});

test("reports failures without rendering retry loops and retries after Refresh", async () => {
  let attempts = 0;
  const cache = createMediaDimensionCache({
    loadDimensions: async (): Promise<MediaDimensions> => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Image host unavailable");
      }
      return { width: 50, height: 100 };
    },
  });
  const items = [mediaItem("offline")];
  const first = await cache.measure({ items });
  expect(first.failedUrls).toEqual(["offline"]);
  expect(first.items[0].orientation).toBe("unknown");
  const sameRender = await cache.measure({ items });
  expect(attempts).toBe(1);
  expect(sameRender.failed).toBe(1);
  cache.clearFailures();
  const retried = await cache.measure({ items });
  expect(attempts).toBe(2);
  expect(retried.failed).toBe(0);
  expect(retried.items[0].orientation).toBe("portrait");
});

test("returns all measured dimensions even when the metadata cache evicts older URLs", async () => {
  const cache = createMediaDimensionCache({
    maxEntries: 1,
    loadDimensions: async (): Promise<MediaDimensions> => ({
      width: 20,
      height: 40,
    }),
  });
  const result = await cache.measure({
    items: [mediaItem("first"), mediaItem("second")],
  });
  expect(result.items.map((item) => item.orientation)).toEqual([
    "portrait",
    "portrait",
  ]);
  expect(cache.apply([mediaItem("first")])[0].orientation).toBe("unknown");
  expect(cache.apply([mediaItem("second")])[0].orientation).toBe("portrait");
});

test("rejects invalid dimensions rather than treating a broken image as square", async () => {
  const cache = createMediaDimensionCache({
    loadDimensions: async (): Promise<MediaDimensions> => ({
      width: 0,
      height: 0,
    }),
  });
  const result = await cache.measure({ items: [mediaItem("broken")] });
  expect(result.failedUrls).toEqual(["broken"]);
  expect(result.items[0].orientation).toBe("unknown");
});

test("native image measurement times out and cleans up without requesting CORS access", async () => {
  const originalImage = globalThis.Image;
  const images: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    src = "";
    crossOrigin: string | null = null;
    removed: string[] = [];
    constructor() {
      images.push(this);
    }
    removeAttribute(name: string): void {
      this.removed.push(name);
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: FakeImage,
  });
  try {
    await expect(
      loadImageDimensions({
        url: "https://images.example/slow.png",
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out");
    expect(images[0].crossOrigin).toBeNull();
    expect(images[0].removed).toEqual(["src"]);
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
  } finally {
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      writable: true,
      value: originalImage,
    });
  }
});

test("native image measurement resolves natural dimensions and releases the detached image", async () => {
  const originalImage = globalThis.Image;
  let image: FakeImage | undefined;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 160;
    naturalHeight = 320;
    removed = false;
    constructor() {
      image = this;
    }
    set src(_url: string) {
      queueMicrotask(() => this.onload?.());
    }
    removeAttribute(): void {
      this.removed = true;
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: FakeImage,
  });
  try {
    await expect(
      loadImageDimensions({
        url: "https://images.example/portrait.png",
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ width: 160, height: 320 });
    expect(image?.removed).toBe(true);
  } finally {
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      writable: true,
      value: originalImage,
    });
  }
});
