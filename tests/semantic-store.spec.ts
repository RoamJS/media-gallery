import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { expect, test } from "@playwright/test";

import {
  SEMANTIC_EMBEDDING_DIMENSION,
  SEMANTIC_INDEX_SCHEMA_VERSION,
  SEMANTIC_MODEL_INFO,
  type SemanticIndexEntry,
  type SemanticIndexRecord,
} from "../src/types/semantic";
import {
  SemanticIndexStorageError,
  SemanticIndexClearedError,
  SEMANTIC_INDEX_DATABASE_NAME,
  SEMANTIC_INDEX_STORE_NAME,
  clearSemanticIndex,
  getSemanticIndexSummary,
  loadSemanticIndex,
  loadSemanticIndexState,
  requestPersistentStorage,
  saveSemanticIndex,
} from "../src/utils/semantic/store";

const entry = ({
  id,
  hash,
}: {
  id: string;
  hash: string;
}): SemanticIndexEntry => ({
  mediaId: id,
  url: `https://example.com/${id}.png`,
  fileName: `${id}.png`,
  mimeType: "image/png",
  mediaType: "image",
  preferredReference: {
    blockUid: `block-${id}`,
    pageUid: `page-${id}`,
    createdTime: 1,
    updatedTime: 2,
    createdAuthor: "Alice",
    updatedAuthor: "Alice",
  },
  contentHash: hash,
});

const record = ({
  graphName,
  entries,
  value = 0.25,
}: {
  graphName: string;
  entries: SemanticIndexEntry[];
  value?: number;
}): SemanticIndexRecord => ({
  graphName,
  schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
  model: { ...SEMANTIC_MODEL_INFO },
  createdAt: 100,
  updatedAt: 200,
  entries,
  embeddings: new Float32Array(
    entries.length * SEMANTIC_EMBEDDING_DIMENSION,
  ).fill(value).buffer,
});

test("upgrades version-one indexes without losing their records", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const isolatedIndexedDb = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: isolatedIndexedDb,
  });
  const source = record({
    graphName: "legacy-graph",
    entries: [entry({ id: "legacy", hash: "legacy" })],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const request = isolatedIndexedDb.open(SEMANTIC_INDEX_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(SEMANTIC_INDEX_STORE_NAME, {
          keyPath: "graphName",
        });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          SEMANTIC_INDEX_STORE_NAME,
          "readwrite",
        );
        transaction.objectStore(SEMANTIC_INDEX_STORE_NAME).put(source);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error);
        };
      };
    });

    const migrated = await loadSemanticIndexState({
      graphName: "legacy-graph",
    });
    expect(migrated.generation).toBe(0);
    expect(migrated.record).toEqual(source);
    await clearSemanticIndex({ graphName: "legacy-graph" });
    await expect(
      loadSemanticIndexState({ graphName: "legacy-graph" }),
    ).resolves.toEqual({
      record: null,
      generation: 1,
    });
  } finally {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  }
});

test("a clear invalidates old writes only for that graph, including an empty index", async () => {
  const graphOne = "semantic-store-generation-one";
  const graphTwo = "semantic-store-generation-two";
  const stateOne = await loadSemanticIndexState({ graphName: graphOne });
  const stateTwo = await loadSemanticIndexState({ graphName: graphTwo });
  const sourceOne = record({ graphName: graphOne, entries: [] });
  const sourceTwo = record({ graphName: graphTwo, entries: [] });

  await clearSemanticIndex({ graphName: graphOne });
  await expect(
    saveSemanticIndex({
      record: sourceOne,
      expectedGeneration: stateOne.generation,
    }),
  ).rejects.toBeInstanceOf(SemanticIndexClearedError);
  await expect(loadSemanticIndex({ graphName: graphOne })).resolves.toBeNull();
  await saveSemanticIndex({
    record: sourceTwo,
    expectedGeneration: stateTwo.generation,
  });
  await expect(loadSemanticIndex({ graphName: graphTwo })).resolves.toEqual(
    sourceTwo,
  );

  const clearedState = await loadSemanticIndexState({ graphName: graphOne });
  await saveSemanticIndex({
    record: sourceOne,
    expectedGeneration: clearedState.generation,
  });
  await expect(loadSemanticIndex({ graphName: graphOne })).resolves.toEqual(
    sourceOne,
  );
});

test("stores a graph index as one contiguous Float32 ArrayBuffer", async () => {
  const graphName = "semantic-store-contiguous";
  await clearSemanticIndex({ graphName });
  const source = record({
    graphName,
    entries: [
      entry({ id: "one", hash: "h1" }),
      entry({ id: "two", hash: "h2" }),
    ],
  });
  await saveSemanticIndex({ record: source });

  const loaded = await loadSemanticIndex({ graphName });
  expect(loaded?.embeddings).toBeInstanceOf(ArrayBuffer);
  expect(loaded?.embeddings.byteLength).toBe(
    2 * SEMANTIC_EMBEDDING_DIMENSION * Float32Array.BYTES_PER_ELEMENT,
  );
  expect(new Float32Array(loaded?.embeddings)[0]).toBeCloseTo(0.25);
  expect(loaded?.entries.map(({ mediaId }) => mediaId)).toEqual(["one", "two"]);
});

test("atomically replaces one graph without changing another graph", async () => {
  const graphOne = "semantic-store-graph-one";
  const graphTwo = "semantic-store-graph-two";
  await Promise.all([
    clearSemanticIndex({ graphName: graphOne }),
    clearSemanticIndex({ graphName: graphTwo }),
  ]);
  await saveSemanticIndex({
    record: record({
      graphName: graphOne,
      entries: [entry({ id: "old", hash: "old" })],
      value: 0.1,
    }),
  });
  await saveSemanticIndex({
    record: record({
      graphName: graphTwo,
      entries: [entry({ id: "other", hash: "other" })],
      value: 0.2,
    }),
  });
  await saveSemanticIndex({
    record: record({
      graphName: graphOne,
      entries: [
        entry({ id: "new-a", hash: "new-a" }),
        entry({ id: "new-b", hash: "new-b" }),
      ],
      value: 0.3,
    }),
  });

  expect(
    (await loadSemanticIndex({ graphName: graphOne }))?.entries.map(
      ({ mediaId }) => mediaId,
    ),
  ).toEqual(["new-a", "new-b"]);
  expect(
    (await loadSemanticIndex({ graphName: graphTwo }))?.entries[0].mediaId,
  ).toBe("other");

  await clearSemanticIndex({ graphName: graphOne });
  expect(await loadSemanticIndex({ graphName: graphOne })).toBeNull();
  expect(await loadSemanticIndex({ graphName: graphTwo })).not.toBeNull();
});

test("returns lightweight missing and populated graph summaries", async () => {
  const graphName = "semantic-store-summary";
  await clearSemanticIndex({ graphName });
  await expect(getSemanticIndexSummary({ graphName })).resolves.toEqual({
    graphName,
    exists: false,
    itemCount: 0,
    byteLength: 0,
    createdAt: null,
    updatedAt: null,
    schemaVersion: null,
    model: null,
  });

  await saveSemanticIndex({
    record: record({
      graphName,
      entries: [entry({ id: "one", hash: "hash" })],
    }),
  });
  await expect(getSemanticIndexSummary({ graphName })).resolves.toMatchObject({
    graphName,
    exists: true,
    itemCount: 1,
    byteLength: SEMANTIC_EMBEDDING_DIMENSION * Float32Array.BYTES_PER_ELEMENT,
    createdAt: 100,
    updatedAt: 200,
    schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
    model: SEMANTIC_MODEL_INFO,
  });
});

test("rejects malformed matrix sizes before replacing the stored record", async () => {
  const graphName = "semantic-store-invalid";
  await clearSemanticIndex({ graphName });
  const valid = record({
    graphName,
    entries: [entry({ id: "valid", hash: "valid" })],
  });
  await saveSemanticIndex({ record: valid });
  const invalid = {
    ...valid,
    entries: [
      entry({ id: "invalid-a", hash: "a" }),
      entry({ id: "invalid-b", hash: "b" }),
    ],
  };

  await expect(saveSemanticIndex({ record: invalid })).rejects.toBeInstanceOf(
    SemanticIndexStorageError,
  );
  expect((await loadSemanticIndex({ graphName }))?.entries[0].mediaId).toBe(
    "valid",
  );
});

test("persistent storage is a best-effort request", async () => {
  await expect(requestPersistentStorage()).resolves.toBe(false);
});
