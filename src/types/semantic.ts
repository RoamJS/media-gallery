import type { MediaReference } from "~/types/media";

export const SEMANTIC_INDEX_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_MODEL_ID = "Xenova/mobileclip_s0" as const;
export const SEMANTIC_MODEL_REVISION =
  "757d59c9c6870a76a4b0306f05f5061bca15c39f" as const;
export const SEMANTIC_EMBEDDING_DIMENSION = 512 as const;
export const SEMANTIC_EMBEDDING_DTYPE = "float32" as const;
export const SEMANTIC_VISION_MODEL_DTYPE = "fp32" as const;
export const SEMANTIC_SEARCH_LIMIT = 24;

export type SemanticModelInfo = {
  modelId: string;
  modelRevision: string;
  dimension: number;
  dtype: "float32";
  normalized: true;
  // Missing precision identifies legacy indexes that must be re-embedded.
  visionModelDtype?: "q8" | "fp32";
};

export const SEMANTIC_MODEL_INFO: SemanticModelInfo = {
  modelId: SEMANTIC_MODEL_ID,
  modelRevision: SEMANTIC_MODEL_REVISION,
  dimension: SEMANTIC_EMBEDDING_DIMENSION,
  dtype: SEMANTIC_EMBEDDING_DTYPE,
  normalized: true,
  visionModelDtype: SEMANTIC_VISION_MODEL_DTYPE,
};

export type SemanticProgressPhase =
  | "initializing"
  | "hashing"
  | "embedding"
  | "saving"
  | "searching";

export type SemanticProgress = {
  phase: SemanticProgressPhase;
  completed: number;
  total: number;
  message?: string;
};

export type SemanticProgressCallback = (progress: SemanticProgress) => void;

export type SemanticCandidate = {
  mediaId: string;
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: "image" | "gif";
  preferredReference: MediaReference | null;
};

export type SemanticHashedCandidate = SemanticCandidate & {
  contentHash: string;
};

export type SemanticIndexEntry = SemanticHashedCandidate;

export type SemanticIndexRecord = {
  graphName: string;
  schemaVersion: typeof SEMANTIC_INDEX_SCHEMA_VERSION;
  model: SemanticModelInfo;
  createdAt: number;
  updatedAt: number;
  entries: SemanticIndexEntry[];
  embeddings: ArrayBuffer;
};

export type SemanticIndexSummary = {
  graphName: string;
  exists: boolean;
  itemCount: number;
  byteLength: number;
  createdAt: number | null;
  updatedAt: number | null;
  schemaVersion: number | null;
  model: SemanticModelInfo | null;
};

export type SemanticBuildSkipStage = "fetch" | "hash" | "decode" | "embedding";

export type SemanticBuildSkip = {
  mediaId: string;
  url: string;
  stage: SemanticBuildSkipStage;
  reason: string;
};

export type SemanticBuildReport = {
  graphName: string;
  candidateCount: number;
  indexedCount: number;
  reusedCount: number;
  embeddedCount: number;
  removedCount: number;
  skipped: SemanticBuildSkip[];
  modelChanged: boolean;
  persistentStorage: boolean;
  summary: SemanticIndexSummary;
};

export type SemanticSearchResult = SemanticIndexEntry & {
  score: number;
  rank: number;
};

export type SemanticFetchAndHashResult = {
  contentHash: string;
  unchanged: boolean;
};

export type SemanticEmbeddingCandidate = SemanticHashedCandidate;

export type SemanticImageEmbedding = {
  mediaId: string;
  url: string;
  vector: Float32Array;
};

export type SemanticEmbedImagesResult = {
  embeddings: SemanticImageEmbedding[];
  skipped: SemanticBuildSkip[];
};

export type SemanticScoredRow = {
  index: number;
  score: number;
};

export type SemanticWorkerClient = {
  initialize: (args?: {
    onProgress?: SemanticProgressCallback;
    signal?: AbortSignal;
  }) => Promise<SemanticModelInfo>;
  fetchAndHash: (args: {
    url: string;
    knownContentHash?: string;
    signal?: AbortSignal;
  }) => Promise<SemanticFetchAndHashResult>;
  embedImages: (args: {
    candidates: SemanticEmbeddingCandidate[];
    onProgress?: SemanticProgressCallback;
    signal?: AbortSignal;
  }) => Promise<SemanticEmbedImagesResult>;
  search: (args: {
    query: string;
    embeddings: Float32Array;
    dimension: number;
    limit: number;
    onProgress?: SemanticProgressCallback;
    signal?: AbortSignal;
  }) => Promise<SemanticScoredRow[]>;
  terminate: () => void;
};

export type SemanticWorkerError = {
  name: string;
  message: string;
  stack?: string;
};

export type SemanticWorkerRequest =
  | {
      requestId: string;
      type: "initialize";
    }
  | {
      requestId: string;
      type: "fetchAndHash";
      url: string;
      knownContentHash?: string;
    }
  | {
      requestId: string;
      type: "embedImages";
      candidates: SemanticEmbeddingCandidate[];
    }
  | {
      requestId: string;
      type: "search";
      query: string;
      embeddings: Float32Array;
      dimension: number;
      limit: number;
    }
  | {
      requestId: string;
      type: "cancel";
    };

export type SemanticWorkerResponse =
  | {
      requestId: string;
      type: "initialized";
      model: SemanticModelInfo;
    }
  | {
      requestId: string;
      type: "fetchAndHashResult";
      result: SemanticFetchAndHashResult;
    }
  | {
      requestId: string;
      type: "embedImagesResult";
      result: SemanticEmbedImagesResult;
    }
  | {
      requestId: string;
      type: "searchResult";
      results: SemanticScoredRow[];
    }
  | {
      requestId: string;
      type: "progress";
      progress: SemanticProgress;
    }
  | {
      requestId: string;
      type: "error";
      error: SemanticWorkerError;
    };
