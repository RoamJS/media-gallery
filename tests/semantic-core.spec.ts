import "fake-indexeddb/auto";

import { expect, test } from "@playwright/test";

import type { MediaItem, MediaReference } from "../src/types/media";
import {
  SEMANTIC_EMBEDDING_DIMENSION,
  SEMANTIC_INDEX_SCHEMA_VERSION,
  SEMANTIC_MODEL_INFO,
  type SemanticIndexEntry,
  type SemanticIndexRecord,
  type SemanticWorkerClient,
} from "../src/types/semantic";
import {
  buildSemanticIndex,
  mapSemanticSearchMatches,
  planSemanticIndexBuild,
  searchSemanticIndex,
  selectSemanticCandidates,
} from "../src/utils/semantic/core";
import {
  clearSemanticIndex,
  loadSemanticIndex,
  saveSemanticIndex,
} from "../src/utils/semantic/store";

const reference = ({
  blockUid,
  updatedTime,
}: {
  blockUid: string;
  updatedTime: number | null;
}): MediaReference => ({
  blockUid,
  pageUid: `page-${blockUid}`,
  createdTime: 1,
  updatedTime,
  createdAuthor: "Alice",
  updatedAuthor: "Alice",
});

const mediaItem = ({
  id,
  url,
  mediaType = "image",
  references = [],
}: {
  id: string;
  url: string;
  mediaType?: MediaItem["mediaType"];
  references?: MediaReference[];
}): MediaItem => ({
  id,
  url,
  fileName: `${id}.${mediaType === "gif" ? "gif" : "png"}`,
  extension: mediaType === "gif" ? "gif" : "png",
  searchText: id,
  mediaType,
  mimeType: mediaType === "gif" ? "image/gif" : "image/png",
  sizeBytes: null,
  width: null,
  height: null,
  orientation: "unknown",
  createdTime: 1,
  updatedTime: 2,
  authors: ["Alice"],
  references,
});

const indexEntry = ({
  id,
  url,
  contentHash,
}: {
  id: string;
  url: string;
  contentHash: string;
}): SemanticIndexEntry => ({
  mediaId: id,
  url,
  fileName: `${id}.png`,
  mimeType: "image/png",
  mediaType: "image",
  preferredReference: reference({ blockUid: id, updatedTime: 1 }),
  contentHash,
});

const matrixBuffer = (rows: number[]): ArrayBuffer => {
  const matrix = new Float32Array(rows.length * SEMANTIC_EMBEDDING_DIMENSION);
  rows.forEach((axis, row) => {
    matrix[row * SEMANTIC_EMBEDDING_DIMENSION + axis] = 1;
  });
  return matrix.buffer;
};

const indexRecord = ({
  graphName,
  entries,
  rows,
  modelRevision,
}: {
  graphName: string;
  entries: SemanticIndexEntry[];
  rows: number[];
  modelRevision?: string;
}): SemanticIndexRecord => ({
  graphName,
  schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
  model: {
    ...SEMANTIC_MODEL_INFO,
    modelRevision: modelRevision || SEMANTIC_MODEL_INFO.modelRevision,
  },
  createdAt: 10,
  updatedAt: 20,
  entries,
  embeddings: matrixBuffer(rows),
});

const workerClient = (
  overrides: Partial<SemanticWorkerClient> = {},
): SemanticWorkerClient => ({
  initialize: async () => ({ ...SEMANTIC_MODEL_INFO }),
  fetchAndHash: async () => ({ contentHash: "hash", unchanged: false }),
  embedImages: async ({ candidates }) => ({
    embeddings: candidates.map((candidate) => ({
      mediaId: candidate.mediaId,
      url: candidate.url,
      vector: new Float32Array(SEMANTIC_EMBEDDING_DIMENSION).fill(
        1 / Math.sqrt(SEMANTIC_EMBEDDING_DIMENSION),
      ),
    })),
    skipped: [],
  }),
  search: async () => [],
  terminate: () => undefined,
  ...overrides,
});

test("selects only image candidates and chooses a stable preferred reference", () => {
  const older = reference({ blockUid: "z-block", updatedTime: 10 });
  const tieLaterUid = reference({ blockUid: "b-block", updatedTime: 20 });
  const tieEarlierUid = reference({ blockUid: "a-block", updatedTime: 20 });
  const candidates = selectSemanticCandidates({
    items: [
      mediaItem({
        id: "duplicate",
        url: "https://example.com/a.png",
        references: [older],
      }),
      mediaItem({
        id: "video",
        url: "https://example.com/video.mp4",
        mediaType: "video",
      }),
      mediaItem({
        id: "image",
        url: "https://example.com/a.png",
        references: [older, tieLaterUid, tieEarlierUid],
      }),
      mediaItem({
        id: "gif",
        url: "https://example.com/b.gif",
        mediaType: "gif",
      }),
    ],
  });

  expect(candidates.map(({ mediaId }) => mediaId)).toEqual([
    "duplicate",
    "gif",
  ]);
  expect(candidates[0].preferredReference?.blockUid).toBe("a-block");

  const preferred = selectSemanticCandidates({
    items: [
      mediaItem({
        id: "image",
        url: "https://example.com/c.png",
        references: [older, tieLaterUid, tieEarlierUid],
      }),
    ],
  });
  expect(preferred[0].preferredReference?.blockUid).toBe("a-block");
});

test("plans exact vector reuse by URL and content hash", () => {
  const existing = indexRecord({
    graphName: "plan-graph",
    entries: [
      indexEntry({
        id: "a",
        url: "https://example.com/a.png",
        contentHash: "same",
      }),
      indexEntry({
        id: "b",
        url: "https://example.com/b.png",
        contentHash: "old",
      }),
    ],
    rows: [0, 1],
  });
  const plan = planSemanticIndexBuild({
    existingIndex: existing,
    candidates: [
      { ...existing.entries[0], fileName: "renamed.png" },
      { ...existing.entries[1], contentHash: "changed" },
      indexEntry({
        id: "c",
        url: "https://example.com/c.png",
        contentHash: "new",
      }),
    ],
  });

  expect(plan.reusedCount).toBe(1);
  expect(plan.embedCount).toBe(2);
  expect(plan.items.map(({ kind }) => kind)).toEqual([
    "reuse",
    "embed",
    "embed",
  ]);
  expect(plan.items[0]).toMatchObject({ kind: "reuse", sourceIndex: 0 });
});

test("maps worker row scores exactly and deterministically", () => {
  const entries = [
    indexEntry({ id: "a", url: "https://example.com/a.png", contentHash: "a" }),
    indexEntry({ id: "b", url: "https://example.com/b.png", contentHash: "b" }),
    indexEntry({ id: "c", url: "https://example.com/c.png", contentHash: "c" }),
  ];
  const results = mapSemanticSearchMatches({
    entries,
    limit: 3,
    matches: [
      { index: 2, score: 0.5 },
      { index: 1, score: 0.9 },
      { index: 0, score: 0.9 },
      { index: 2, score: 0.7 },
      { index: -1, score: 1 },
      { index: 20, score: 1 },
      { index: 0, score: Number.NaN },
    ],
  });

  expect(
    results.map(({ mediaId, score, rank }) => ({ mediaId, score, rank })),
  ).toEqual([
    { mediaId: "a", score: 0.9, rank: 1 },
    { mediaId: "b", score: 0.9, rank: 2 },
    { mediaId: "c", score: 0.7, rank: 3 },
  ]);
});

test("incrementally rebuilds one atomic matrix and reports stale and skipped rows", async () => {
  const graphName = "semantic-core-incremental";
  await clearSemanticIndex({ graphName });
  await saveSemanticIndex({
    record: indexRecord({
      graphName,
      entries: [
        indexEntry({
          id: "a",
          url: "https://example.com/a.png",
          contentHash: "a-hash",
        }),
        indexEntry({
          id: "stale",
          url: "https://example.com/z.png",
          contentHash: "z-hash",
        }),
      ],
      rows: [0, 2],
    }),
  });

  let initializeCount = 0;
  const client = workerClient({
    initialize: async () => {
      initializeCount += 1;
      return { ...SEMANTIC_MODEL_INFO };
    },
    fetchAndHash: async ({ url }) => {
      if (url.endsWith("bad.png")) {
        throw new Error("CORS blocked image bytes");
      }
      return {
        contentHash: url.endsWith("a.png") ? "a-hash" : "b-hash",
        unchanged: url.endsWith("a.png"),
      };
    },
    embedImages: async ({ candidates }) => ({
      embeddings: candidates.map((candidate) => {
        const vector = new Float32Array(SEMANTIC_EMBEDDING_DIMENSION);
        vector[1] = 2;
        return {
          mediaId: candidate.mediaId,
          url: candidate.url,
          vector,
        };
      }),
      skipped: [],
    }),
  });
  const report = await buildSemanticIndex({
    graphName,
    client,
    items: [
      mediaItem({ id: "a-current", url: "https://example.com/a.png" }),
      mediaItem({ id: "b", url: "https://example.com/b.png" }),
      mediaItem({ id: "bad", url: "https://example.com/bad.png" }),
      mediaItem({
        id: "video",
        url: "https://example.com/v.mp4",
        mediaType: "video",
      }),
    ],
  });

  expect(initializeCount).toBe(1);
  expect(report).toMatchObject({
    candidateCount: 3,
    indexedCount: 2,
    reusedCount: 1,
    embeddedCount: 1,
    removedCount: 1,
    modelChanged: false,
  });
  expect(report.skipped).toEqual([
    expect.objectContaining({
      mediaId: "bad",
      stage: "fetch",
      reason: "CORS blocked image bytes",
    }),
  ]);

  const stored = await loadSemanticIndex({ graphName });
  expect(stored?.entries.map(({ mediaId }) => mediaId)).toEqual([
    "a-current",
    "b",
  ]);
  expect(stored?.embeddings.byteLength).toBe(
    2 * SEMANTIC_EMBEDDING_DIMENSION * Float32Array.BYTES_PER_ELEMENT,
  );
  const matrix = new Float32Array(stored?.embeddings);
  expect(matrix[0]).toBe(1);
  expect(matrix[SEMANTIC_EMBEDDING_DIMENSION + 1]).toBe(1);
});

test("does not initialize the model for an unchanged rebuild", async () => {
  const graphName = "semantic-core-unchanged";
  await clearSemanticIndex({ graphName });
  const entry = indexEntry({
    id: "old-id",
    url: "https://example.com/same.png",
    contentHash: "same-hash",
  });
  await saveSemanticIndex({
    record: indexRecord({ graphName, entries: [entry], rows: [3] }),
  });
  const client = workerClient({
    initialize: async () => {
      throw new Error("MobileCLIP should not load");
    },
    fetchAndHash: async ({ knownContentHash }) => ({
      contentHash: knownContentHash || "",
      unchanged: true,
    }),
    embedImages: async () => {
      throw new Error("No embedding should run");
    },
  });

  const report = await buildSemanticIndex({
    graphName,
    client,
    items: [mediaItem({ id: "current-id", url: entry.url })],
  });
  expect(report.reusedCount).toBe(1);
  expect(report.embeddedCount).toBe(0);
  expect((await loadSemanticIndex({ graphName }))?.entries[0].mediaId).toBe(
    "current-id",
  );
});

for (const legacyPrecision of [undefined, "q8"] as const) {
  test(`replaces ${legacyPrecision ?? "unlabeled legacy"} vision embeddings even when image bytes are unchanged`, async () => {
    const graphName = `semantic-core-precision-${legacyPrecision ?? "legacy"}`;
    await clearSemanticIndex({ graphName });
    const entry = indexEntry({
      id: "same-image",
      url: "https://example.com/precision.png",
      contentHash: "same-hash",
    });
    const legacy = indexRecord({ graphName, entries: [entry], rows: [0] });
    legacy.model.visionModelDtype = legacyPrecision;
    await saveSemanticIndex({ record: legacy });
    let embeddingCalls = 0;
    const client = workerClient({
      fetchAndHash: async () => ({
        contentHash: "same-hash",
        unchanged: true,
      }),
      embedImages: async ({ candidates }) => {
        embeddingCalls += 1;
        return {
          skipped: [],
          embeddings: candidates.map(({ mediaId, url }) => ({
            mediaId,
            url,
            vector: new Float32Array(SEMANTIC_EMBEDDING_DIMENSION).fill(
              1 / Math.sqrt(SEMANTIC_EMBEDDING_DIMENSION),
            ),
          })),
        };
      },
    });
    await expect(
      searchSemanticIndex({ graphName, query: "dog", client }),
    ).rejects.toThrow("Semantic model mismatch");
    const report = await buildSemanticIndex({
      graphName,
      items: [mediaItem({ id: "same-image", url: entry.url })],
      client,
    });
    expect(embeddingCalls).toBe(1);
    expect(report).toMatchObject({
      modelChanged: true,
      reusedCount: 0,
      embeddedCount: 1,
    });
    const stored = await loadSemanticIndex({ graphName });
    expect(stored?.model.visionModelDtype).toBe("fp32");
    expect(new Float32Array(stored?.embeddings)[0]).not.toBe(1);
  });
}

test("builds an empty graph index without loading the model", async () => {
  const graphName = "semantic-core-empty";
  await clearSemanticIndex({ graphName });
  const client = workerClient({
    initialize: async () => {
      throw new Error("MobileCLIP should not load");
    },
    fetchAndHash: async () => {
      throw new Error("There are no candidates to hash");
    },
    embedImages: async () => {
      throw new Error("There are no candidates to embed");
    },
  });

  const report = await buildSemanticIndex({
    graphName,
    client,
    items: [
      mediaItem({
        id: "video",
        url: "https://example.com/video.mp4",
        mediaType: "video",
      }),
    ],
  });
  expect(report).toMatchObject({
    candidateCount: 0,
    indexedCount: 0,
    reusedCount: 0,
    embeddedCount: 0,
    skipped: [],
  });
  expect((await loadSemanticIndex({ graphName }))?.embeddings.byteLength).toBe(
    0,
  );
});

test("a persisted model mismatch forces a complete re-embedding", async () => {
  const graphName = "semantic-core-model-change";
  await clearSemanticIndex({ graphName });
  const entry = indexEntry({
    id: "a",
    url: "https://example.com/a.png",
    contentHash: "same-hash",
  });
  await saveSemanticIndex({
    record: indexRecord({
      graphName,
      entries: [entry],
      rows: [0],
      modelRevision: "previous-revision",
    }),
  });
  let receivedKnownHash: string | undefined = "not-called";
  let embedCount = 0;
  const client = workerClient({
    fetchAndHash: async ({ knownContentHash }) => {
      receivedKnownHash = knownContentHash;
      return { contentHash: "same-hash", unchanged: false };
    },
    embedImages: async ({ candidates }) => {
      embedCount = candidates.length;
      return {
        embeddings: candidates.map((candidate) => ({
          mediaId: candidate.mediaId,
          url: candidate.url,
          vector: new Float32Array(SEMANTIC_EMBEDDING_DIMENSION).fill(
            1 / Math.sqrt(SEMANTIC_EMBEDDING_DIMENSION),
          ),
        })),
        skipped: [],
      };
    },
  });

  const report = await buildSemanticIndex({
    graphName,
    client,
    items: [mediaItem({ id: "a", url: entry.url })],
  });
  expect(receivedKnownHash).toBeUndefined();
  expect(embedCount).toBe(1);
  expect(report).toMatchObject({
    modelChanged: true,
    reusedCount: 0,
    embeddedCount: 1,
  });
});

test("search delegates exact scanning and maps row indexes to flat UI results", async () => {
  const graphName = "semantic-core-search";
  await clearSemanticIndex({ graphName });
  const entries = [
    indexEntry({ id: "a", url: "https://example.com/a.png", contentHash: "a" }),
    indexEntry({ id: "b", url: "https://example.com/b.png", contentHash: "b" }),
    indexEntry({ id: "c", url: "https://example.com/c.png", contentHash: "c" }),
  ];
  await saveSemanticIndex({
    record: indexRecord({ graphName, entries, rows: [0, 1, 2] }),
  });
  let searchArgs: { query: string; limit: number; rows: number } | null = null;
  const client = workerClient({
    search: async ({ query, limit, embeddings, dimension }) => {
      searchArgs = { query, limit, rows: embeddings.length / dimension };
      return [
        { index: 2, score: 0.6 },
        { index: 1, score: 0.8 },
        { index: 0, score: 0.8 },
      ];
    },
  });

  const results = await searchSemanticIndex({
    graphName,
    query: "  handwritten diagram  ",
    client,
    limit: 2,
  });
  expect(searchArgs).toEqual({
    query: "handwritten diagram",
    limit: 2,
    rows: 3,
  });
  expect(
    results.map(({ mediaId, rank, score }) => ({ mediaId, rank, score })),
  ).toEqual([
    { mediaId: "a", rank: 1, score: 0.8 },
    { mediaId: "b", rank: 2, score: 0.8 },
  ]);
});

test("clearing during a build prevents that build from recreating the index", async () => {
  const graphName = "semantic-core-clear-during-build";
  const otherGraph = "semantic-core-clear-other-graph";
  const item = mediaItem({ id: "a", url: "https://example.com/a.png" });
  const otherRecord = indexRecord({
    graphName: otherGraph,
    entries: [],
    rows: [],
  });
  await saveSemanticIndex({ record: otherRecord });
  const client = workerClient({
    fetchAndHash: async () => {
      // Each storage call opens its own connection, as another tab would.
      await clearSemanticIndex({ graphName });
      return { contentHash: "hash", unchanged: false };
    },
  });

  await expect(
    buildSemanticIndex({ graphName, items: [item], client }),
  ).rejects.toThrow("This graph's image index was cleared while indexing");
  await expect(loadSemanticIndex({ graphName })).resolves.toBeNull();
  await expect(loadSemanticIndex({ graphName: otherGraph })).resolves.toEqual(
    otherRecord,
  );

  const freshBuild = await buildSemanticIndex({
    graphName,
    items: [item],
    client: workerClient(),
  });
  expect(freshBuild.indexedCount).toBe(1);
  expect((await loadSemanticIndex({ graphName }))?.entries).toHaveLength(1);
});
