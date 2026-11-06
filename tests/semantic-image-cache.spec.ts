import { expect, test } from "@playwright/test";

import { createSemanticImageCache } from "../src/utils/semantic/imageCache";

const image = (contentHash: string, size: number) => ({
  contentHash,
  blob: new Blob([new Uint8Array(size)]),
});

test("bounds retained image bytes when hashing a large graph", () => {
  const cache = createSemanticImageCache({ maxBytes: 10, maxEntries: 8 });
  for (let index = 0; index < 1_000; index += 1) {
    cache.set({ url: `image-${index}`, image: image(`hash-${index}`, 4) });
    expect(cache.sizeBytes).toBeLessThanOrEqual(10);
    expect(cache.size).toBeLessThanOrEqual(8);
  }
  expect(cache.sizeBytes).toBe(8);
  expect(
    cache.get({ url: "image-997", contentHash: "hash-997" }),
  ).toBeUndefined();
  expect(
    cache.get({ url: "image-999", contentHash: "hash-999" }),
  ).toBeDefined();
});

test("evicts least-recently-used images when the entry limit is reached", () => {
  const cache = createSemanticImageCache({ maxBytes: 100, maxEntries: 2 });
  const firstImage = image("first-hash", 2);
  cache.set({ url: "first", image: firstImage });
  cache.set({ url: "second", image: image("second-hash", 2) });
  expect(cache.get({ url: "first", contentHash: "first-hash" })).toBe(
    firstImage,
  );
  cache.set({ url: "third", image: image("third-hash", 2) });
  expect(
    cache.get({ url: "second", contentHash: "second-hash" }),
  ).toBeUndefined();
  expect(cache.get({ url: "first", contentHash: "first-hash" })).toBe(
    firstImage,
  );
});

test("preserves exact blobs and never returns bytes for a different content hash", () => {
  const cache = createSemanticImageCache({ maxBytes: 10, maxEntries: 2 });
  const original = image("original", 4);
  const changed = image("changed", 3);
  cache.set({ url: "image", image: original });
  expect(cache.get({ url: "image", contentHash: "original" })?.blob).toBe(
    original.blob,
  );
  cache.set({ url: "image", image: changed });
  expect(cache.sizeBytes).toBe(3);
  expect(cache.get({ url: "image", contentHash: "original" })).toBeUndefined();
  expect(cache.get({ url: "image", contentHash: "changed" })?.blob).toBe(
    changed.blob,
  );
});

test("does not retain oversized originals and releases all accounting on clear", () => {
  const cache = createSemanticImageCache({ maxBytes: 10, maxEntries: 2 });
  cache.set({ url: "small", image: image("small", 3) });
  cache.set({ url: "large", image: image("large", 11) });
  expect(cache.get({ url: "large", contentHash: "large" })).toBeUndefined();
  expect(cache.sizeBytes).toBe(3);
  cache.set({ url: "small", image: image("oversized-replacement", 11) });
  expect(cache.sizeBytes).toBe(0);
  expect(cache.size).toBe(0);
  cache.set({ url: "next", image: image("next", 5) });
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.sizeBytes).toBe(0);
  expect(cache.get({ url: "next", contentHash: "next" })).toBeUndefined();
});
