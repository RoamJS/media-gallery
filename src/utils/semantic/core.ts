import type { MediaItem, MediaReference } from "~/types/media";
import {
  SEMANTIC_EMBEDDING_DIMENSION,
  SEMANTIC_INDEX_SCHEMA_VERSION,
  SEMANTIC_MODEL_INFO,
  SEMANTIC_SEARCH_LIMIT,
  type SemanticBuildReport,
  type SemanticBuildSkip,
  type SemanticCandidate,
  type SemanticHashedCandidate,
  type SemanticIndexEntry,
  type SemanticIndexRecord,
  type SemanticModelInfo,
  type SemanticProgressCallback,
  type SemanticScoredRow,
  type SemanticSearchResult,
  type SemanticWorkerClient,
} from "~/types/semantic";
import { getPreferredMediaReference } from "~/utils/media/roam";
import {
  getSemanticIndexSummary,
  loadSemanticIndex,
  loadSemanticIndexState,
  requestPersistentStorage,
  saveSemanticIndex,
} from "~/utils/semantic/store";

const HASH_CONCURRENCY = 4;
const NORMALIZATION_TOLERANCE = 1e-5;

const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

export class SemanticModelMismatchError extends Error {
  constructor({
    expected,
    actual,
  }: {
    expected: SemanticModelInfo;
    actual: SemanticModelInfo;
  }) {
    super(
      `Semantic model mismatch: expected ${expected.modelId}@${expected.modelRevision} (${expected.dimension}d ${expected.dtype}, ${expected.visionModelDtype ?? "q8"} vision), received ${actual.modelId}@${actual.modelRevision} (${actual.dimension}d ${actual.dtype}, ${actual.visionModelDtype ?? "q8"} vision).`,
    );
    this.name = "SemanticModelMismatchError";
  }
}

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const compareReferences = (
  a: MediaReference | null,
  b: MediaReference | null,
): number => {
  if (!a) {
    return b ? 1 : 0;
  }
  if (!b) {
    return -1;
  }
  const updatedDifference = (b.updatedTime ?? 0) - (a.updatedTime ?? 0);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }
  return compareStrings(a.blockUid, b.blockUid);
};

const compareCandidates = (
  a: SemanticCandidate,
  b: SemanticCandidate,
): number =>
  compareStrings(a.url, b.url) ||
  compareStrings(a.mediaId, b.mediaId) ||
  compareStrings(a.fileName, b.fileName) ||
  compareStrings(a.mimeType, b.mimeType) ||
  compareStrings(a.mediaType, b.mediaType) ||
  compareReferences(a.preferredReference, b.preferredReference);

export const selectSemanticCandidates = ({
  items,
}: {
  items: MediaItem[];
}): SemanticCandidate[] => {
  const candidates = items
    .filter(
      (item): item is MediaItem & { mediaType: "image" | "gif" } =>
        (item.mediaType === "image" || item.mediaType === "gif") &&
        Boolean(item.url),
    )
    .map<SemanticCandidate>((item) => ({
      mediaId: item.id || item.url,
      url: item.url,
      fileName: item.fileName,
      mimeType: item.mimeType,
      mediaType: item.mediaType,
      preferredReference: getPreferredMediaReference({ item }),
    }))
    .sort(compareCandidates);

  const candidatesByUrl = new Map<string, SemanticCandidate>();
  candidates.forEach((candidate) => {
    const existing = candidatesByUrl.get(candidate.url);
    if (!existing) {
      candidatesByUrl.set(candidate.url, candidate);
      return;
    }
    const preferredReference =
      compareReferences(
        existing.preferredReference,
        candidate.preferredReference,
      ) <= 0
        ? existing.preferredReference
        : candidate.preferredReference;
    candidatesByUrl.set(candidate.url, {
      ...existing,
      preferredReference,
    });
  });
  return Array.from(candidatesByUrl.values()).sort(compareCandidates);
};

export const areSemanticModelsEqual = ({
  a,
  b,
}: {
  a: SemanticModelInfo;
  b: SemanticModelInfo;
}): boolean =>
  a.modelId === b.modelId &&
  a.modelRevision === b.modelRevision &&
  a.dimension === b.dimension &&
  a.dtype === b.dtype &&
  a.normalized === b.normalized &&
  a.visionModelDtype === b.visionModelDtype;

export const isSemanticIndexCompatible = (
  record: SemanticIndexRecord,
): boolean =>
  record.schemaVersion === SEMANTIC_INDEX_SCHEMA_VERSION &&
  areSemanticModelsEqual({ a: record.model, b: SEMANTIC_MODEL_INFO }) &&
  record.embeddings.byteLength ===
    record.entries.length *
      SEMANTIC_EMBEDDING_DIMENSION *
      Float32Array.BYTES_PER_ELEMENT;

const assertExpectedModel = (actual: SemanticModelInfo): void => {
  if (!areSemanticModelsEqual({ a: actual, b: SEMANTIC_MODEL_INFO })) {
    throw new SemanticModelMismatchError({
      expected: SEMANTIC_MODEL_INFO,
      actual,
    });
  }
};

export type SemanticBuildPlanItem =
  | {
      kind: "reuse";
      candidate: SemanticHashedCandidate;
      sourceIndex: number;
    }
  | {
      kind: "embed";
      candidate: SemanticHashedCandidate;
    };

export type SemanticBuildPlan = {
  items: SemanticBuildPlanItem[];
  reusedCount: number;
  embedCount: number;
};

export const planSemanticIndexBuild = ({
  candidates,
  existingIndex,
}: {
  candidates: SemanticHashedCandidate[];
  existingIndex: SemanticIndexRecord | null;
}): SemanticBuildPlan => {
  const existingByUrl = new Map<
    string,
    { entry: SemanticIndexEntry; index: number }
  >();
  existingIndex?.entries.forEach((entry, index) => {
    if (!existingByUrl.has(entry.url)) {
      existingByUrl.set(entry.url, { entry, index });
    }
  });

  const items = candidates.map<SemanticBuildPlanItem>((candidate) => {
    const existing = existingByUrl.get(candidate.url);
    if (existing?.entry.contentHash === candidate.contentHash) {
      return {
        kind: "reuse",
        candidate,
        sourceIndex: existing.index,
      };
    }
    return { kind: "embed", candidate };
  });
  return {
    items,
    reusedCount: items.filter((item) => item.kind === "reuse").length,
    embedCount: items.filter((item) => item.kind === "embed").length,
  };
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DOMException("The semantic operation was aborted.", "AbortError");
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const mapWithConcurrency = async <T, U>({
  items,
  concurrency,
  map,
}: {
  items: T[];
  concurrency: number;
  map: (item: T, index: number) => Promise<U>;
}): Promise<U[]> => {
  const output = new Array<U>(items.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await map(items[index], index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      run,
    ),
  );
  return output;
};

type HashCandidateResult =
  | { candidate: SemanticHashedCandidate; skip?: never }
  | { candidate?: never; skip: SemanticBuildSkip };

const hashCandidates = async ({
  candidates,
  existingIndex,
  client,
  onProgress,
  signal,
}: {
  candidates: SemanticCandidate[];
  existingIndex: SemanticIndexRecord | null;
  client: SemanticWorkerClient;
  onProgress?: SemanticProgressCallback;
  signal?: AbortSignal;
}): Promise<HashCandidateResult[]> => {
  const existingByUrl = new Map(
    existingIndex?.entries.map((entry) => [entry.url, entry]) || [],
  );
  let completed = 0;
  onProgress?.({
    phase: "hashing",
    completed,
    total: candidates.length,
  });

  return mapWithConcurrency({
    items: candidates,
    concurrency: HASH_CONCURRENCY,
    map: async (candidate): Promise<HashCandidateResult> => {
      throwIfAborted(signal);
      const knownContentHash = existingByUrl.get(candidate.url)?.contentHash;
      try {
        const result = await client.fetchAndHash({
          url: candidate.url,
          knownContentHash,
          signal,
        });
        throwIfAborted(signal);
        const contentHash = result.contentHash.trim();
        if (!contentHash) {
          return {
            skip: {
              mediaId: candidate.mediaId,
              url: candidate.url,
              stage: "hash",
              reason: "The worker returned an empty content hash.",
            },
          };
        }
        return { candidate: { ...candidate, contentHash } };
      } catch (error) {
        throwIfAborted(signal);
        return {
          skip: {
            mediaId: candidate.mediaId,
            url: candidate.url,
            stage: "fetch",
            reason: getErrorMessage(error),
          },
        };
      } finally {
        completed += 1;
        onProgress?.({
          phase: "hashing",
          completed,
          total: candidates.length,
        });
      }
    },
  });
};

const normalizeEmbedding = (vector: Float32Array): Float32Array | null => {
  if (vector.length !== SEMANTIC_EMBEDDING_DIMENSION) {
    return null;
  }
  let squaredNorm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (!Number.isFinite(value)) {
      return null;
    }
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm === 0) {
    return null;
  }
  if (Math.abs(norm - 1) <= NORMALIZATION_TOLERANCE) {
    return new Float32Array(vector);
  }
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / norm;
  }
  return normalized;
};

const getCandidateKey = ({
  mediaId,
  url,
}: {
  mediaId: string;
  url: string;
}): string => `${mediaId}\u0000${url}`;

const sortSkips = (skips: SemanticBuildSkip[]): SemanticBuildSkip[] =>
  [...skips].sort(
    (a, b) =>
      compareStrings(a.url, b.url) ||
      compareStrings(a.mediaId, b.mediaId) ||
      compareStrings(a.stage, b.stage) ||
      compareStrings(a.reason, b.reason),
  );

const createIndexMatrix = ({
  rows,
  existingIndex,
  embeddingsByKey,
}: {
  rows: SemanticBuildPlanItem[];
  existingIndex: SemanticIndexRecord | null;
  embeddingsByKey: Map<string, Float32Array>;
}): { entries: SemanticIndexEntry[]; embeddings: ArrayBuffer } => {
  const entries: SemanticIndexEntry[] = [];
  const vectors: Float32Array[] = [];
  const existingEmbeddings = existingIndex
    ? new Float32Array(existingIndex.embeddings)
    : null;

  rows.forEach((row) => {
    let vector: Float32Array | undefined;
    if (row.kind === "reuse" && existingEmbeddings) {
      const offset = row.sourceIndex * SEMANTIC_EMBEDDING_DIMENSION;
      vector = existingEmbeddings.slice(
        offset,
        offset + SEMANTIC_EMBEDDING_DIMENSION,
      );
    } else {
      vector = embeddingsByKey.get(getCandidateKey(row.candidate));
    }
    if (!vector) {
      return;
    }
    entries.push(row.candidate);
    vectors.push(vector);
  });

  const matrix = new Float32Array(
    entries.length * SEMANTIC_EMBEDDING_DIMENSION,
  );
  vectors.forEach((vector, rowIndex) => {
    matrix.set(vector, rowIndex * SEMANTIC_EMBEDDING_DIMENSION);
  });
  return { entries, embeddings: matrix.buffer };
};

const getRemovedCount = ({
  candidates,
  existingIndex,
}: {
  candidates: SemanticCandidate[];
  existingIndex: SemanticIndexRecord | null;
}): number => {
  const currentUrls = new Set(candidates.map((candidate) => candidate.url));
  return (
    existingIndex?.entries.filter((entry) => !currentUrls.has(entry.url))
      .length || 0
  );
};

export const buildSemanticIndex = async ({
  graphName,
  items,
  client,
  onProgress,
  signal,
}: {
  graphName: string;
  items: MediaItem[];
  client: SemanticWorkerClient;
  onProgress?: SemanticProgressCallback;
  signal?: AbortSignal;
}): Promise<SemanticBuildReport> => {
  throwIfAborted(signal);
  const candidates = selectSemanticCandidates({ items });
  const { record: existingIndex, generation } = await loadSemanticIndexState({
    graphName,
  });
  const compatibleExistingIndex =
    existingIndex && isSemanticIndexCompatible(existingIndex)
      ? existingIndex
      : null;
  const modelChanged = Boolean(
    existingIndex &&
    !areSemanticModelsEqual({
      a: existingIndex.model,
      b: SEMANTIC_MODEL_INFO,
    }),
  );
  const hashResults = await hashCandidates({
    candidates,
    existingIndex: compatibleExistingIndex,
    client,
    onProgress,
    signal,
  });
  const hashedCandidates = hashResults.flatMap((result) =>
    result.candidate ? [result.candidate] : [],
  );
  const skips = hashResults.flatMap((result) =>
    result.skip ? [result.skip] : [],
  );
  const plan = planSemanticIndexBuild({
    candidates: hashedCandidates,
    existingIndex: compatibleExistingIndex,
  });
  const candidatesToEmbed = plan.items.flatMap((item) =>
    item.kind === "embed" ? [item.candidate] : [],
  );

  const embeddingsByKey = new Map<string, Float32Array>();
  if (candidatesToEmbed.length > 0) {
    throwIfAborted(signal);
    onProgress?.({ phase: "initializing", completed: 0, total: 1 });
    const workerModel = await client.initialize({ onProgress, signal });
    assertExpectedModel(workerModel);
    onProgress?.({ phase: "initializing", completed: 1, total: 1 });
    onProgress?.({
      phase: "embedding",
      completed: 0,
      total: candidatesToEmbed.length,
    });
    try {
      const result = await client.embedImages({
        candidates: candidatesToEmbed,
        onProgress,
        signal,
      });
      const requestedKeys = new Set(
        candidatesToEmbed.map((candidate) => getCandidateKey(candidate)),
      );
      result.embeddings.forEach((embedding) => {
        const key = getCandidateKey(embedding);
        if (!requestedKeys.has(key) || embeddingsByKey.has(key)) {
          return;
        }
        const normalized = normalizeEmbedding(embedding.vector);
        if (normalized) {
          embeddingsByKey.set(key, normalized);
        }
      });
      result.skipped.forEach((skip) => {
        if (
          requestedKeys.has(getCandidateKey(skip)) &&
          !embeddingsByKey.has(getCandidateKey(skip))
        ) {
          skips.push(skip);
        }
      });
    } catch (error) {
      throwIfAborted(signal);
      candidatesToEmbed.forEach((candidate) => {
        skips.push({
          mediaId: candidate.mediaId,
          url: candidate.url,
          stage: "embedding",
          reason: getErrorMessage(error),
        });
      });
    }
  }

  const skippedKeys = new Set(skips.map((skip) => getCandidateKey(skip)));
  candidatesToEmbed.forEach((candidate) => {
    const key = getCandidateKey(candidate);
    if (embeddingsByKey.has(key) || skippedKeys.has(key)) {
      return;
    }
    skips.push({
      mediaId: candidate.mediaId,
      url: candidate.url,
      stage: "embedding",
      reason: "The worker did not return a valid 512-dimensional embedding.",
    });
  });

  const successfulPlanItems = plan.items.filter(
    (item) =>
      item.kind === "reuse" ||
      embeddingsByKey.has(getCandidateKey(item.candidate)),
  );
  const matrix = createIndexMatrix({
    rows: successfulPlanItems,
    existingIndex: compatibleExistingIndex,
    embeddingsByKey,
  });
  const timestamp = Date.now();
  const record: SemanticIndexRecord = {
    graphName: graphName.trim(),
    schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
    model: { ...SEMANTIC_MODEL_INFO },
    createdAt: compatibleExistingIndex?.createdAt ?? timestamp,
    updatedAt: timestamp,
    entries: matrix.entries,
    embeddings: matrix.embeddings,
  };

  throwIfAborted(signal);
  onProgress?.({ phase: "saving", completed: 0, total: 1 });
  await saveSemanticIndex({ record, expectedGeneration: generation });
  onProgress?.({ phase: "saving", completed: 1, total: 1 });
  const [persistentStorage, summary] = await Promise.all([
    requestPersistentStorage(),
    getSemanticIndexSummary({ graphName }),
  ]);

  return {
    graphName: record.graphName,
    candidateCount: candidates.length,
    indexedCount: record.entries.length,
    reusedCount: successfulPlanItems.filter((item) => item.kind === "reuse")
      .length,
    embeddedCount: embeddingsByKey.size,
    removedCount: getRemovedCount({ candidates, existingIndex }),
    skipped: sortSkips(skips),
    modelChanged,
    persistentStorage,
    summary,
  };
};

export const mapSemanticSearchMatches = ({
  entries,
  matches,
  limit,
}: {
  entries: SemanticIndexEntry[];
  matches: SemanticScoredRow[];
  limit: number;
}): SemanticSearchResult[] => {
  const safeLimit = normalizeLimit(limit);
  const bestScoreByIndex = new Map<number, number>();
  matches.forEach(({ index, score }) => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= entries.length ||
      !Number.isFinite(score)
    ) {
      return;
    }
    const existingScore = bestScoreByIndex.get(index);
    if (existingScore === undefined || score > existingScore) {
      bestScoreByIndex.set(index, score);
    }
  });

  return Array.from(bestScoreByIndex, ([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, safeLimit)
    .map(({ index, score }, resultIndex) => ({
      ...entries[index],
      score,
      rank: resultIndex + 1,
    }));
};

export const searchSemanticIndex = async ({
  graphName,
  query,
  client,
  limit = SEMANTIC_SEARCH_LIMIT,
  onProgress,
  signal,
}: {
  graphName: string;
  query: string;
  client: SemanticWorkerClient;
  limit?: number;
  onProgress?: SemanticProgressCallback;
  signal?: AbortSignal;
}): Promise<SemanticSearchResult[]> => {
  const normalizedQuery = query.trim();
  const safeLimit = normalizeLimit(limit);
  if (!normalizedQuery || safeLimit === 0) {
    return [];
  }
  throwIfAborted(signal);
  const index = await loadSemanticIndex({ graphName });
  if (!index || index.entries.length === 0) {
    return [];
  }
  if (!isSemanticIndexCompatible(index)) {
    throw new SemanticModelMismatchError({
      expected: SEMANTIC_MODEL_INFO,
      actual: index.model,
    });
  }
  const workerModel = await client.initialize({ onProgress, signal });
  assertExpectedModel(workerModel);
  onProgress?.({ phase: "searching", completed: 0, total: 1 });
  const matches = await client.search({
    query: normalizedQuery,
    embeddings: new Float32Array(index.embeddings),
    dimension: SEMANTIC_EMBEDDING_DIMENSION,
    limit: Math.min(safeLimit, index.entries.length),
    onProgress,
    signal,
  });
  throwIfAborted(signal);
  onProgress?.({ phase: "searching", completed: 1, total: 1 });
  return mapSemanticSearchMatches({
    entries: index.entries,
    matches,
    limit: safeLimit,
  });
};
