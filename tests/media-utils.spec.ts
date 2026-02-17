import { test, expect } from "@playwright/test";

import type { MediaFilters, MediaItem } from "../src/types/media";
import { applyMediaFilters } from "../src/utils/media/filter";
import {
  classifyMediaType,
  extractMediaReferences,
  extractMediaUrls,
  inferOrientation,
  parseMediaUrl,
} from "../src/utils/media/url";

const baseFilters = (): MediaFilters => ({
  query: "",
  author: "all",
  mediaType: "all",
  orientation: "all",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: "",
  sortBy: "updated",
  sortDirection: "desc",
});

const sampleItems: MediaItem[] = [
  {
    id: "1",
    url: "https://example.com/a.jpg",
    fileName: "a.jpg",
    extension: "jpg",
    searchText: "a.jpg vacation",
    mediaType: "image",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    width: 100,
    height: 200,
    orientation: "portrait",
    createdTime: Date.parse("2026-01-01T10:00:00Z"),
    updatedTime: Date.parse("2026-01-02T10:00:00Z"),
    authors: ["Alice"],
    references: [],
  },
  {
    id: "2",
    url: "https://example.com/b.mp4",
    fileName: "b.mp4",
    extension: "mp4",
    searchText: "b.mp4 keynote",
    mediaType: "video",
    mimeType: "video/mp4",
    sizeBytes: 321,
    width: 300,
    height: 100,
    orientation: "landscape",
    createdTime: Date.parse("2026-01-03T10:00:00Z"),
    updatedTime: Date.parse("2026-01-04T10:00:00Z"),
    authors: ["Bob"],
    references: [],
  },
];

test("extracts and parses media URLs", () => {
  const blockString =
    "Here ![](https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2Fgraph%2Fcat.png?alt=media&token=abc) plus text.";
  const urls = extractMediaUrls(blockString);
  expect(urls).toHaveLength(1);
  expect(urls[0].fileName).toBe("cat.png");
  expect(urls[0].mediaType).toBe("image");

  const parsed = parseMediaUrl(
    "https://firebasestorage.googleapis.com/v0/b/graph/o/imgs%2Fapp%2Fgraph%2Fclip.mp4?alt=media&token=xyz",
  );
  expect(parsed?.fileName).toBe("clip.mp4");
  expect(parsed?.mediaType).toBe("video");
});

test("does not throw on malformed percent encoding", () => {
  const bad = parseMediaUrl(
    "https://firebasestorage.googleapis.com/v0/b/graph/o/imgs%2Fapp%2Fgraph%2Fbad%name.png?alt=media&token=xyz",
  );
  expect(bad?.mediaType).toBe("image");

  const extracted = extractMediaUrls(
    "broken https://firebasestorage.googleapis.com/v0/b/graph/o/imgs%2Fapp%2Fgraph%2Fbad%name.png?alt=media&token=xyz done",
  );
  expect(extracted).toHaveLength(1);
});

test("classifies media types and orientation", () => {
  expect(classifyMediaType({ extension: "gif", mimeType: "" })).toBe("gif");
  expect(classifyMediaType({ extension: "mp4", mimeType: "" })).toBe("video");
  expect(classifyMediaType({ extension: "pdf", mimeType: "" })).toBe("pdf");
  expect(classifyMediaType({ extension: "", mimeType: "image/png" })).toBe(
    "image",
  );
  expect(inferOrientation({ width: 200, height: 100 })).toBe("landscape");
  expect(inferOrientation({ width: 100, height: 200 })).toBe("portrait");
  expect(inferOrientation({ width: 150, height: 150 })).toBe("square");
  expect(inferOrientation({ width: null, height: 100 })).toBe("unknown");
});

test("extracts markdown text as searchable content", () => {
  const refs = extractMediaReferences(
    "![Sprint Demo](https://example.com/demo.gif) and [Spec](https://example.com/spec.pdf)",
  );
  expect(refs).toHaveLength(2);
  expect(refs.find((r) => r.url.includes("demo.gif"))?.searchText).toContain(
    "Sprint Demo",
  );
  expect(refs.find((r) => r.url.includes("spec.pdf"))?.searchText).toContain(
    "Spec",
  );
});

test("applies author, type, date, and sort filters", () => {
  const authorFilters = baseFilters();
  authorFilters.author = "Alice";
  const authorResults = applyMediaFilters({
    items: sampleItems,
    filters: authorFilters,
  });
  expect(authorResults).toHaveLength(1);
  expect(authorResults[0].id).toBe("1");

  const typeFilters = baseFilters();
  typeFilters.mediaType = "video";
  typeFilters.orientation = "landscape";
  const typeResults = applyMediaFilters({
    items: sampleItems,
    filters: typeFilters,
  });
  expect(typeResults).toHaveLength(1);
  expect(typeResults[0].id).toBe("2");

  const dateFilters = baseFilters();
  dateFilters.createdFrom = "2026-01-02";
  const dateResults = applyMediaFilters({
    items: sampleItems,
    filters: dateFilters,
  });
  expect(dateResults).toHaveLength(1);
  expect(dateResults[0].id).toBe("2");

  const sortFilters = baseFilters();
  sortFilters.sortBy = "created";
  sortFilters.sortDirection = "asc";
  const sortResults = applyMediaFilters({
    items: sampleItems,
    filters: sortFilters,
  });
  expect(sortResults.map((r) => r.id)).toEqual(["1", "2"]);

  const textFilters = baseFilters();
  textFilters.query = "keynote";
  const textResults = applyMediaFilters({
    items: sampleItems,
    filters: textFilters,
  });
  expect(textResults).toHaveLength(1);
  expect(textResults[0].id).toBe("2");
});
