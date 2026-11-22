import { canCopyImage } from "../src/utils/media/clipboard";
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

test("keeps adjacent Markdown images separate with their own labels", () => {
  const refs = extractMediaReferences(
    "![A](https://example.com/a.png)![B](https://example.com/b.png)",
  );

  expect(
    refs.map(({ url, displayName, mediaType }) => ({
      url,
      displayName,
      mediaType,
    })),
  ).toEqual([
    { url: "https://example.com/a.png", displayName: "A", mediaType: "image" },
    { url: "https://example.com/b.png", displayName: "B", mediaType: "image" },
  ]);
});

test("keeps extensionless adjacent images eligible for semantic indexing", () => {
  const refs = extractMediaReferences(
    "![First](https://example.com/first)![Second](https://example.com/second)",
  );

  expect(refs.map(({ url, mediaType }) => ({ url, mediaType }))).toEqual([
    { url: "https://example.com/first", mediaType: "image" },
    { url: "https://example.com/second", mediaType: "image" },
  ]);
  expect(refs[0].searchText).toContain("First");
  expect(refs[1].searchText).toContain("Second");
});

test("separates adjacent file links, images and Roam media macros", () => {
  const refs = extractMediaReferences(
    "[Spec](https://example.com/spec.pdf)![Photo](https://example.com/photo.png){{video: https://example.com/stream}}{{audio: https://example.com/sound}}",
  );

  expect(refs.map(({ url, mediaType }) => ({ url, mediaType }))).toEqual([
    { url: "https://example.com/spec.pdf", mediaType: "pdf" },
    { url: "https://example.com/photo.png", mediaType: "image" },
    { url: "https://example.com/stream", mediaType: "video" },
    { url: "https://example.com/sound", mediaType: "audio" },
  ]);
});

test("preserves plain URLs around recognized references and deduplicates repeats", () => {
  const refs = extractMediaReferences(
    "https://example.com/before.png![Photo](https://example.com/photo.png)https://example.com/after.png ![Again](https://example.com/photo.png)",
  );

  expect(refs.map(({ url }) => url)).toEqual([
    "https://example.com/before.png",
    "https://example.com/photo.png",
    "https://example.com/after.png",
  ]);
  expect(refs[1].searchText).toContain("Photo");
  expect(refs[1].searchText).toContain("Again");
});

for (const url of [
  "https://example.com/photo(1).png",
  "https://example.com/gallery((1)).png",
  "https://example.com/render?crop=(center)",
  "https://example.com/photo(1)",
  "https://commons.wikimedia.org/wiki/File:Red_vintage_car_in_La_Habana_(10108264664).jpg",
]) {
  test(`preserves balanced parentheses in Markdown media URL: ${url}`, () => {
    const refs = extractMediaReferences(`![Photo](${url})`);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      url,
      mediaType: "image",
      displayName: "Photo",
    });
  });
}

test("keeps adjacent balanced Markdown targets separate from a plain URL", () => {
  const refs = extractMediaReferences(
    "![Photo](https://example.com/photo(1).png)[Spec](https://example.com/spec(2).pdf)https://example.com/after.jpg",
  );

  expect(refs.map(({ url, mediaType }) => ({ url, mediaType }))).toEqual([
    { url: "https://example.com/photo(1).png", mediaType: "image" },
    { url: "https://example.com/spec(2).pdf", mediaType: "pdf" },
    { url: "https://example.com/after.jpg", mediaType: "image" },
  ]);
});

test("retains encoded parentheses and quoted-title URL fallback", () => {
  const refs = extractMediaReferences(
    '![Photo](https://example.com/photo%281%29.png) ![Other](https://example.com/other(2).png "Photo title")',
  );

  expect(refs.map(({ url }) => url)).toEqual([
    "https://example.com/photo%281%29.png",
    "https://example.com/other(2).png",
  ]);
});

for (const title of [
  '"Photo title"',
  "'Photo title'",
  "(Photo title)",
  '"Photo \\"title\\""',
]) {
  test(`retains extensionless image hints and labels with Markdown title: ${title}`, () => {
    const url = "https://example.com/render?id=1";
    const refs = extractMediaReferences(`![Photo](${url} ${title})`);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      url,
      mediaType: "image",
      displayName: "Photo",
      searchText: expect.stringContaining("Photo"),
    });
  });
}

test("retains titled Firebase image hints beside other titled references", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/opaque?alt=media";
  const refs = extractMediaReferences(
    `![Uploaded photo](${url} "Uploaded title")![Other](https://example.com/render(2) 'Other title')`,
  );

  expect(
    refs.map(({ url, mediaType, displayName }) => ({
      url,
      mediaType,
      displayName,
    })),
  ).toEqual([
    { url, mediaType: "image", displayName: "Uploaded photo" },
    {
      url: "https://example.com/render(2)",
      mediaType: "image",
      displayName: "Other",
    },
  ]);
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

for (const url of [
  "https://example.com/render?id=1",
  "https://firebasestorage.googleapis.com/v0/b/graph/o/opaque?alt=media",
  "https://example.com/photo.png",
]) {
  test(`preserves an image wrapped in a Markdown link: ${url}`, () => {
    const refs = extractMediaReferences(
      `[![Photo](${url})](https://example.com/page)`,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      url,
      mediaType: "image",
      displayName: "Photo",
      searchText: expect.stringContaining("Photo"),
    });
    expect(refs[0].displayName).not.toContain("![");
  });
}

test("keeps adjacent linked images and titled targets separate", () => {
  const refs = extractMediaReferences(
    '[![First](https://example.com/render(1) "First title")](https://example.com/page)![Second](https://example.com/render(2))[Spec](https://example.com/spec.pdf)',
  );

  expect(
    refs.map(({ url, mediaType, displayName }) => ({
      url,
      mediaType,
      displayName,
    })),
  ).toEqual([
    {
      url: "https://example.com/render(1)",
      mediaType: "image",
      displayName: "First",
    },
    {
      url: "https://example.com/render(2)",
      mediaType: "image",
      displayName: "Second",
    },
    {
      url: "https://example.com/spec.pdf",
      mediaType: "pdf",
      displayName: "Spec",
    },
  ]);
});

test("keeps the image hint when a linked image URL also appears plainly", () => {
  const url = "https://example.com/render?id=1";
  const refs = extractMediaReferences(
    `${url} [![Photo](${url})](https://example.com/page)`,
  );

  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({
    url,
    mediaType: "image",
    displayName: "Photo",
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

test("keeps explicit targets intact and trims prose punctuation only for bare URLs", () => {
  const root = "https://example.test/photo.png?caption=Hello";
  const bracket = "https://example.test/photo.png?rect=[0,0,100,100]";
  const audio = "https://example.test/file.mp3?end=.";
  expect(
    extractMediaUrls(
      `![a](${root}.) ![b](${bracket}) {{[[audio]]: ${audio}}} also ${root}.`,
    ).map((x) => x.url),
  ).toEqual([root + ".", bracket, audio, root]);
});

test("recovers an opaque image upload's format from its stored image reference", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/opaque?alt=media";
  for (const [ext, mime] of [
    ["PNG", "image/png"],
    ["jpg", "image/jpeg"],
    ["bmp", "image/bmp"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
  ]) {
    const reference = formatUploadedMediaReference({
      url,
      fileName: "Photo." + ext,
      mediaType: "image",
    });
    const parsed = extractMediaReferences(reference)[0];
    expect(parsed.mimeType).toBe(mime);
    expect(canCopyImage(parsed.mimeType)).toBe(
      ["PNG", "jpg", "bmp"].includes(ext),
    );
  }
  expect(extractMediaReferences(`[Photo.png](${url})`)[0].mimeType).toBe(
    "application/octet-stream",
  );
});

test("keeps the closing punctuation in a native PDF macro", () => {
  const url = "https://example.test/paper.pdf?caption=Hello.";
  expect(extractMediaUrls(`{{[[pdf]]: ${url}}}`)).toMatchObject([
    { url, mediaType: "pdf" },
  ]);
});

test("uses a filename even when an earlier image caption contains a dot", () => {
  const url =
    "https://firebasestorage.googleapis.com/v0/b/graph/o/opaque?alt=media";
  expect(
    extractMediaReferences(`![Fig. 1](${url}) ![Photo.png](${url})`)[0]
      .mimeType,
  ).toBe("image/png");
});
