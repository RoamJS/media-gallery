import {
  SEMANTIC_INDEX_SCHEMA_VERSION,
  type SemanticIndexRecord,
  type SemanticIndexSummary,
  type SemanticModelInfo,
} from "~/types/semantic";

export const SEMANTIC_INDEX_DATABASE_NAME = "roamjs-media-gallery-semantic";
export const SEMANTIC_INDEX_STORE_NAME = "graph-indexes";
const GENERATION_STORE_NAME = "graph-generations";

const DATABASE_VERSION = 2;

export class SemanticIndexStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SemanticIndexStorageError";
  }
}

export class SemanticIndexClearedError extends SemanticIndexStorageError {
  constructor() {
    super(
      "This graph's image index was cleared while indexing. Start a new build to index it again.",
    );
    this.name = "SemanticIndexClearedError";
  }
}

const normalizeGraphName = (graphName: string): string => {
  const normalized = graphName.trim();
  if (!normalized) {
    throw new TypeError("A graph name is required for the semantic index.");
  }
  return normalized;
};

const getIndexedDb = (): IDBFactory => {
  if (typeof indexedDB === "undefined") {
    throw new SemanticIndexStorageError(
      "IndexedDB is unavailable in this environment.",
    );
  }
  return indexedDB;
};

const getRequestError = ({
  request,
  fallback,
}: {
  request: IDBRequest;
  fallback: string;
}): SemanticIndexStorageError =>
  new SemanticIndexStorageError(request.error?.message || fallback, {
    cause: request.error || undefined,
  });

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = getIndexedDb().open(
      SEMANTIC_INDEX_DATABASE_NAME,
      DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEMANTIC_INDEX_STORE_NAME)) {
        database.createObjectStore(SEMANTIC_INDEX_STORE_NAME, {
          keyPath: "graphName",
        });
      }
      if (!database.objectStoreNames.contains(GENERATION_STORE_NAME)) {
        database.createObjectStore(GENERATION_STORE_NAME, {
          keyPath: "graphName",
        });
      }
    };
    request.onerror = () =>
      reject(
        getRequestError({
          request,
          fallback: "Unable to open the semantic index database.",
        }),
      );
    request.onblocked = () =>
      reject(
        new SemanticIndexStorageError(
          "Opening the semantic index database was blocked.",
        ),
      );
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const isModelInfo = (value: unknown): value is SemanticModelInfo => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.modelId === "string" &&
    typeof value.modelRevision === "string" &&
    Number.isInteger(value.dimension) &&
    (value.dimension as number) > 0 &&
    value.dtype === "float32" &&
    value.normalized === true &&
    (value.visionModelDtype === undefined ||
      value.visionModelDtype === "q8" ||
      value.visionModelDtype === "fp32")
  );
};

const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer ||
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";

const isNullableFiniteNumber = (value: unknown): boolean =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const isStoredReference = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.blockUid === "string" &&
    typeof value.pageUid === "string" &&
    isNullableFiniteNumber(value.createdTime) &&
    isNullableFiniteNumber(value.updatedTime) &&
    typeof value.createdAuthor === "string" &&
    typeof value.updatedAuthor === "string"
  );
};

const isIndexEntry = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.mediaId === "string" &&
    value.mediaId.length > 0 &&
    typeof value.url === "string" &&
    value.url.length > 0 &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    (value.mediaType === "image" || value.mediaType === "gif") &&
    typeof value.contentHash === "string" &&
    value.contentHash.length > 0 &&
    isStoredReference(value.preferredReference)
  );
};

const assertRecordShape = (value: unknown): SemanticIndexRecord => {
  if (!isRecord(value)) {
    throw new SemanticIndexStorageError(
      "The stored semantic index is not a record.",
    );
  }
  if (
    typeof value.graphName !== "string" ||
    !value.graphName.trim() ||
    !Number.isInteger(value.schemaVersion) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isIndexEntry) ||
    !isModelInfo(value.model) ||
    !isArrayBuffer(value.embeddings)
  ) {
    throw new SemanticIndexStorageError(
      "The stored semantic index metadata is invalid.",
    );
  }

  const expectedByteLength =
    value.entries.length *
    value.model.dimension *
    Float32Array.BYTES_PER_ELEMENT;
  if (value.embeddings.byteLength !== expectedByteLength) {
    throw new SemanticIndexStorageError(
      `The stored semantic index matrix has ${value.embeddings.byteLength} bytes; expected ${expectedByteLength}.`,
    );
  }
  return value as unknown as SemanticIndexRecord;
};

const readGeneration = (value: unknown): number => {
  if (value === undefined) {
    return 0;
  }
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0
  ) {
    throw new SemanticIndexStorageError(
      "The stored semantic index generation is invalid.",
    );
  }
  return value.generation as number;
};

export const loadSemanticIndexState = async ({
  graphName,
}: {
  graphName: string;
}): Promise<{ record: SemanticIndexRecord | null; generation: number }> => {
  const normalizedGraphName = normalizeGraphName(graphName);
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        [SEMANTIC_INDEX_STORE_NAME, GENERATION_STORE_NAME],
        "readonly",
      );
      const request = transaction
        .objectStore(SEMANTIC_INDEX_STORE_NAME)
        .get(normalizedGraphName);
      const generationRequest = transaction
        .objectStore(GENERATION_STORE_NAME)
        .get(normalizedGraphName);
      request.onerror = () =>
        reject(
          getRequestError({
            request,
            fallback: "Unable to load the semantic index.",
          }),
        );
      transaction.oncomplete = () => {
        try {
          resolve({
            record:
              request.result === undefined
                ? null
                : assertRecordShape(request.result),
            generation: readGeneration(generationRequest.result),
          });
        } catch (error) {
          reject(error);
        }
      };
      transaction.onabort = () =>
        reject(
          new SemanticIndexStorageError(
            transaction.error?.message ||
              "Loading the semantic index was aborted.",
            { cause: transaction.error || undefined },
          ),
        );
    });
  } finally {
    database.close();
  }
};

export const loadSemanticIndex = async ({
  graphName,
}: {
  graphName: string;
}): Promise<SemanticIndexRecord | null> =>
  (await loadSemanticIndexState({ graphName })).record;

export const saveSemanticIndex = async ({
  record,
  expectedGeneration,
}: {
  record: SemanticIndexRecord;
  expectedGeneration?: number;
}): Promise<void> => {
  const graphName = normalizeGraphName(record.graphName);
  if (record.schemaVersion !== SEMANTIC_INDEX_SCHEMA_VERSION) {
    throw new SemanticIndexStorageError(
      `Cannot save semantic index schema ${record.schemaVersion}; expected ${SEMANTIC_INDEX_SCHEMA_VERSION}.`,
    );
  }
  assertRecordShape(record);

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [SEMANTIC_INDEX_STORE_NAME, GENERATION_STORE_NAME],
        "readwrite",
      );
      // Checking and writing in one transaction prevents another tab's clear
      // from being undone by a build that started before that clear.
      const request = transaction
        .objectStore(GENERATION_STORE_NAME)
        .get(graphName);
      request.onsuccess = () => {
        try {
          const generation = readGeneration(request.result);
          if (
            expectedGeneration !== undefined &&
            generation !== expectedGeneration
          ) {
            throw new SemanticIndexClearedError();
          }
          transaction
            .objectStore(SEMANTIC_INDEX_STORE_NAME)
            .put({ ...record, graphName });
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      request.onerror = () =>
        reject(
          getRequestError({
            request,
            fallback: "Unable to save the semantic index.",
          }),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new SemanticIndexStorageError(
            transaction.error?.message || "Saving the semantic index failed.",
            { cause: transaction.error || undefined },
          ),
        );
      transaction.onabort = () =>
        reject(
          new SemanticIndexStorageError(
            transaction.error?.message ||
              "Saving the semantic index was aborted.",
            { cause: transaction.error || undefined },
          ),
        );
    });
  } finally {
    database.close();
  }
};

export const clearSemanticIndex = async ({
  graphName,
}: {
  graphName: string;
}): Promise<void> => {
  const normalizedGraphName = normalizeGraphName(graphName);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [SEMANTIC_INDEX_STORE_NAME, GENERATION_STORE_NAME],
        "readwrite",
      );
      const request = transaction
        .objectStore(GENERATION_STORE_NAME)
        .get(normalizedGraphName);
      request.onsuccess = () => {
        try {
          const generation = readGeneration(request.result) + 1;
          if (!Number.isSafeInteger(generation)) {
            throw new SemanticIndexStorageError(
              "The semantic index generation limit was reached.",
            );
          }
          transaction.objectStore(GENERATION_STORE_NAME).put({
            graphName: normalizedGraphName,
            generation,
          });
          transaction
            .objectStore(SEMANTIC_INDEX_STORE_NAME)
            .delete(normalizedGraphName);
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      request.onerror = () =>
        reject(
          getRequestError({
            request,
            fallback: "Unable to clear the semantic index.",
          }),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new SemanticIndexStorageError(
            transaction.error?.message || "Clearing the semantic index failed.",
            { cause: transaction.error || undefined },
          ),
        );
      transaction.onabort = () =>
        reject(
          new SemanticIndexStorageError(
            transaction.error?.message ||
              "Clearing the semantic index was aborted.",
            { cause: transaction.error || undefined },
          ),
        );
    });
  } finally {
    database.close();
  }
};

export const getSemanticIndexSummary = async ({
  graphName,
}: {
  graphName: string;
}): Promise<SemanticIndexSummary> => {
  const normalizedGraphName = normalizeGraphName(graphName);
  const record = await loadSemanticIndex({ graphName: normalizedGraphName });
  if (!record) {
    return {
      graphName: normalizedGraphName,
      exists: false,
      itemCount: 0,
      byteLength: 0,
      createdAt: null,
      updatedAt: null,
      schemaVersion: null,
      model: null,
    };
  }
  return {
    graphName: normalizedGraphName,
    exists: true,
    itemCount: record.entries.length,
    byteLength: record.embeddings.byteLength,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    schemaVersion: record.schemaVersion,
    model: record.model,
  };
};

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return false;
  }
  try {
    if (
      typeof navigator.storage.persisted === "function" &&
      (await navigator.storage.persisted())
    ) {
      return true;
    }
    return await navigator.storage.persist();
  } catch (_error) {
    return false;
  }
};
