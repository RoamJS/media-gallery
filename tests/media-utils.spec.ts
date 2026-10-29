import { test, expect } from "@playwright/test";

import type { MediaFilters, MediaItem } from "../src/types/media";
import {
  applyMediaFilters,
  applySemanticResultFilters,
} from "../src/utils/media/filter";
import {
  extractUploadedFileUrl,
  formatUploadedMediaReference,
  getPreferredMediaReference,
  openMediaItemSource,
  openMediaItemReferences,
} from "../src/utils/media/roam";
import {
  classifyMediaType,
  extractMediaReferences,
  extractMediaUrls,
  inferOrientation,
  isRoamStorageUrl,
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

test("uses explicit media markup when URLs have no file extension", () => {
  const refs = extractMediaReferences(
    "![RoamJS logo](https://avatars.githubusercontent.com/u/138642184) {{video: https://media.example.com/stream}}",
  );

  expect(refs).toHaveLength(2);
  expect(refs[0]).toMatchObject({
    mediaType: "image",
    displayName: "RoamJS logo",
    searchText: expect.stringContaining("RoamJS logo"),
  });
  expect(refs[1]).toMatchObject({
    mediaType: "video",
    searchText: expect.stringContaining("video"),
  });
});

test("deduplicates an uploaded preview and preserves its filename link", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/generated.png?alt=media";
  const refs = extractMediaReferences(
    `![](${url}) [Quarterly chart.png](${url})`,
  );

  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({
    displayName: "Quarterly chart.png",
    searchText: expect.stringContaining("Quarterly chart.png"),
  });
});

test("identifies URLs that Roam can delete from graph storage", () => {
  expect(
    isRoamStorageUrl(
      "https://firebasestorage.googleapis.com/v0/b/graph/o/image.png?alt=media",
    ),
  ).toBe(true);
  expect(isRoamStorageUrl("https://example.com/image.png")).toBe(false);
  expect(isRoamStorageUrl("not a url")).toBe(false);
});

test("preserves an uploaded image filename in Roam-compatible Markdown", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/generated.png?alt=media";

  expect(
    formatUploadedMediaReference({
      url,
      fileName: "Quarterly [draft] chart.png",
    }),
  ).toBe(`![Quarterly draft chart.png](${url})`);
});

test("extracts the URL from Roam's upload response", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/generated.png?alt=media";

  expect(extractUploadedFileUrl(`![](${url})`)).toBe(url);
  expect(extractUploadedFileUrl(url)).toBe(url);
  expect(extractUploadedFileUrl("not an upload result")).toBeNull();
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

test("selects the newest media reference with a stable block UID tie-break", () => {
  const item: MediaItem = {
    ...sampleItems[0],
    references: [
      {
        blockUid: "z-block",
        pageUid: "page-1",
        createdTime: 10,
        updatedTime: 100,
        createdAuthor: "Alice",
        updatedAuthor: "Alice",
      },
      {
        blockUid: "b-block",
        pageUid: "page-2",
        createdTime: 20,
        updatedTime: 200,
        createdAuthor: "Bob",
        updatedAuthor: "Bob",
      },
      {
        blockUid: "a-block",
        pageUid: "page-3",
        createdTime: 30,
        updatedTime: 200,
        createdAuthor: "Carol",
        updatedAuthor: "Carol",
      },
    ],
  };

  expect(getPreferredMediaReference({ item })).toMatchObject({
    blockUid: "a-block",
    pageUid: "page-3",
  });
  expect(
    getPreferredMediaReference({ item: { ...item, references: [] } }),
  ).toBeNull();
});

test("opens the preferred media source block in Roam's main window", async () => {
  const originalWindow = globalThis.window;
  let openedUid = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        ui: {
          mainWindow: {
            openBlock: async ({
              block,
            }: {
              block: { uid: string };
            }): Promise<void> => {
              openedUid = block.uid;
            },
          },
        },
      },
    },
    writable: true,
  });

  const item: MediaItem = {
    ...sampleItems[0],
    references: [
      {
        blockUid: "older-block",
        pageUid: "page-1",
        createdTime: 10,
        updatedTime: 100,
        createdAuthor: "Alice",
        updatedAuthor: "Alice",
      },
      {
        blockUid: "newer-block",
        pageUid: "page-2",
        createdTime: 20,
        updatedTime: 200,
        createdAuthor: "Bob",
        updatedAuthor: "Bob",
      },
    ],
  };

  try {
    await openMediaItemSource({ item });
    expect(openedUid).toBe("newer-block");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("semantic filters include matches below the initial 24 and preserve similarity order", () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    ...sampleItems[0],
    id: `${index}`,
    url: `https://example.com/${index}.jpg`,
    authors: [index >= 24 ? "Bob" : "Alice"],
    updatedTime: 30 - index,
  }));
  const results = items.map((item, index) => ({
    mediaId: item.id,
    url: item.url,
    fileName: item.fileName,
    mimeType: item.mimeType,
    mediaType: "image" as const,
    preferredReference: null,
    contentHash: item.id,
    score: 1 - index / 100,
    rank: index + 1,
  }));
  const filtered = applySemanticResultFilters({
    results,
    items,
    filters: {
      ...baseFilters(),
      author: "Bob",
      query: "unrelated keyword",
      orientation: "portrait",
      mediaType: "image",
      createdFrom: "2026-01-01",
      createdTo: "2026-01-01",
      sortBy: "created",
      sortDirection: "asc",
    },
  });
  expect(filtered.map(({ mediaId }) => mediaId)).toEqual([
    "24",
    "25",
    "26",
    "27",
    "28",
    "29",
  ]);
  expect(
    applySemanticResultFilters({
      results,
      items,
      filters: { ...baseFilters(), orientation: "landscape" },
    }),
  ).toEqual([]);
  expect(
    applySemanticResultFilters({
      results,
      items,
      filters: { ...baseFilters(), updatedFrom: "2026-01-01" },
    }),
  ).toEqual([]);
  expect(
    applySemanticResultFilters({
      results,
      items,
      filters: { ...baseFilters(), mediaType: "video" },
    }),
  ).toEqual([]);
  expect(results).toHaveLength(30);
});

test("opens each distinct referring block in the native sidebar without changing the graph", async () => {
  const originalWindow = globalThis.window;
  const actions: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      roamAlphaAPI: {
        ui: {
          rightSidebar: {
            addWindow: async (action: unknown): Promise<void> => {
              actions.push(action);
            },
          },
        },
      },
    },
  });
  try {
    const reference = {
      blockUid: "first",
      pageUid: "page",
      createdTime: null,
      updatedTime: null,
      createdAuthor: "Alice",
      updatedAuthor: "Alice",
    };
    await openMediaItemReferences({
      item: {
        ...sampleItems[0],
        references: [
          reference,
          { ...reference, blockUid: "second" },
          reference,
        ],
      },
    });
    expect(actions).toEqual([
      { window: { type: "block", "block-uid": "second" } },
      { window: { type: "block", "block-uid": "first" } },
    ]);
    await openMediaItemReferences({ item: sampleItems[0] });
    expect(actions).toHaveLength(2);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  }
});
