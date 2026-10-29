import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
} from "@huggingface/transformers";

import {
  SEMANTIC_EMBEDDING_DIMENSION,
  SEMANTIC_MODEL_ID,
  SEMANTIC_MODEL_INFO,
  SEMANTIC_MODEL_REVISION,
  SEMANTIC_VISION_MODEL_DTYPE,
} from "~/types/semantic";
import type {
  SemanticBuildSkip,
  SemanticEmbedImagesResult,
  SemanticEmbeddingCandidate,
  SemanticFetchAndHashResult,
  SemanticImageEmbedding,
  SemanticProgress,
  SemanticScoredRow,
  SemanticWorkerError,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from "~/types/semantic";
import { selectSemanticInferenceDevice } from "~/utils/semantic/device";
import {
  createSemanticImageCache,
  type CachedSemanticImage,
} from "~/utils/semantic/imageCache";
import { rankEmbeddingsByDotProduct } from "~/utils/semantic/rank";

type ModelLoadProgress = {
  status: string;
  file?: string;
  progress?: number;
};

type ProgressReporter = (progress: SemanticProgress) => void;

type LoadedModels = {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  textModel: Awaited<
    ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>
  >;
  visionModel: Awaited<
    ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>
  >;
};

type SemanticWorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SemanticWorkerRequest>) => void,
  ) => void;
  postMessage: (
    response: SemanticWorkerResponse,
    transfer?: Transferable[],
  ) => void;
};

const workerScope = globalThis as unknown as SemanticWorkerScope;
const activeRequests = new Map<string, AbortController>();
// Hashing visits the whole graph before embedding; never retain all originals.
const cachedImages = createSemanticImageCache();
const initializationReporters = new Set<ProgressReporter>();

let loadedModels: LoadedModels | null = null;
let modelsPromise: Promise<LoadedModels> | null = null;

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException(
      "The semantic worker request was cancelled.",
      "AbortError",
    );
  }
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const serializeError = (error: unknown): SemanticWorkerError => {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }

  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
};

const emitInitializationProgress = (progress: SemanticProgress): void => {
  initializationReporters.forEach((reporter) => reporter(progress));
};

const reportModelLoadProgress = (progress: ModelLoadProgress): void => {
  if (progress.status !== "progress" && progress.status !== "progress_total") {
    return;
  }

  emitInitializationProgress({
    phase: "initializing",
    completed: Math.max(0, Math.min(100, Math.round(progress.progress ?? 0))),
    total: 100,
    message: progress.file
      ? `Downloading ${progress.file}`
      : "Downloading the semantic image model",
  });
};

const configureTransformersEnvironment = (): void => {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useWasmCache = true;

  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
};

const loadProjectionModels = async ({
  device,
}: {
  device: "webgpu" | "wasm";
}): Promise<Pick<LoadedModels, "textModel" | "visionModel">> => {
  let textModel: LoadedModels["textModel"] | null = null;

  try {
    textModel = await CLIPTextModelWithProjection.from_pretrained(
      SEMANTIC_MODEL_ID,
      {
        revision: SEMANTIC_MODEL_REVISION,
        device,
        dtype: "q8",
        progress_callback: reportModelLoadProgress,
      },
    );
    const visionModel = await CLIPVisionModelWithProjection.from_pretrained(
      SEMANTIC_MODEL_ID,
      {
        revision: SEMANTIC_MODEL_REVISION,
        device,
        // The model's q8 vision weights break image/text similarity alignment.
        dtype: SEMANTIC_VISION_MODEL_DTYPE,
        progress_callback: reportModelLoadProgress,
      },
    );

    return { textModel, visionModel };
  } catch (error) {
    await textModel?.dispose();
    throw error;
  }
};

const loadModels = async (): Promise<LoadedModels> => {
  configureTransformersEnvironment();
  emitInitializationProgress({
    phase: "initializing",
    completed: 0,
    total: 100,
    message: "Loading MobileCLIP S0",
  });

  const [tokenizer, processor] = await Promise.all([
    AutoTokenizer.from_pretrained(SEMANTIC_MODEL_ID, {
      revision: SEMANTIC_MODEL_REVISION,
      progress_callback: reportModelLoadProgress,
    }),
    AutoProcessor.from_pretrained(SEMANTIC_MODEL_ID, {
      revision: SEMANTIC_MODEL_REVISION,
      progress_callback: reportModelLoadProgress,
    }),
  ]);

  const preferredDevice = await selectSemanticInferenceDevice();
  let projectionModels: Pick<LoadedModels, "textModel" | "visionModel">;

  if (preferredDevice === "wasm") {
    emitInitializationProgress({
      phase: "initializing",
      completed: 0,
      total: 100,
      message: "WebGPU adapter unavailable; using WebAssembly",
    });
  }

  try {
    projectionModels = await loadProjectionModels({ device: preferredDevice });
  } catch (webGpuError) {
    if (preferredDevice === "wasm") {
      throw webGpuError;
    }

    emitInitializationProgress({
      phase: "initializing",
      completed: 0,
      total: 100,
      message: "WebGPU initialization failed; using WebAssembly instead",
    });
    try {
      projectionModels = await loadProjectionModels({ device: "wasm" });
    } catch (wasmError) {
      throw new Error(
        `WebGPU initialization failed (${getErrorMessage(webGpuError)}); WebAssembly fallback also failed (${getErrorMessage(wasmError)}).`,
        { cause: wasmError },
      );
    }
  }

  emitInitializationProgress({
    phase: "initializing",
    completed: 100,
    total: 100,
    message: "MobileCLIP S0 is ready",
  });

  return { tokenizer, processor, ...projectionModels };
};

const initializeModels = async ({
  onProgress,
  signal,
  reportReadyWhenCached = false,
}: {
  onProgress: ProgressReporter;
  signal: AbortSignal;
  reportReadyWhenCached?: boolean;
}): Promise<LoadedModels> => {
  throwIfAborted(signal);
  if (loadedModels) {
    if (reportReadyWhenCached) {
      onProgress({
        phase: "initializing",
        completed: 100,
        total: 100,
        message: "MobileCLIP S0 is ready",
      });
    }
    return loadedModels;
  }

  initializationReporters.add(onProgress);

  try {
    if (!modelsPromise) {
      modelsPromise = loadModels()
        .then((models) => {
          loadedModels = models;
          return models;
        })
        .catch((error: unknown) => {
          modelsPromise = null;
          throw error;
        });
    }

    const models = await modelsPromise;
    throwIfAborted(signal);
    return models;
  } finally {
    initializationReporters.delete(onProgress);
  }
};

const releaseCachedImage = ({ url }: { url: string }): void => {
  cachedImages.delete(url);
};

const hashBytes = async (bytes: ArrayBuffer): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    const error = new Error("SHA-256 is unavailable in this browser context.");
    error.name = "HashError";
    throw error;
  }

  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch (cause) {
    const error = new Error(
      `Could not hash the fetched image: ${getErrorMessage(cause)}`,
    );
    error.name = "HashError";
    throw error;
  }
};

const fetchImage = async ({
  url,
  signal,
}: {
  url: string;
  signal: AbortSignal;
}): Promise<CachedSemanticImage> => {
  let response: Response;

  try {
    response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) {
      throw cause;
    }

    throw new Error(
      `Could not fetch the image; its host may block cross-origin access (CORS): ${getErrorMessage(cause)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Could not fetch the image (${response.status} ${response.statusText || "HTTP error"}).`,
    );
  }

  const bytes = await response.arrayBuffer();
  throwIfAborted(signal);
  const contentHash = await hashBytes(bytes);
  throwIfAborted(signal);
  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  const image = {
    blob: new Blob([bytes], { type: contentType }),
    contentHash,
  };
  cachedImages.set({ url, image });
  return image;
};

const fetchAndHash = async ({
  url,
  knownContentHash,
  signal,
}: {
  url: string;
  knownContentHash?: string;
  signal: AbortSignal;
}): Promise<SemanticFetchAndHashResult> => {
  const image = await fetchImage({ url, signal });
  const unchanged =
    typeof knownContentHash === "string" &&
    knownContentHash === image.contentHash;

  if (unchanged) {
    releaseCachedImage({ url });
  }

  return {
    contentHash: image.contentHash,
    unchanged,
  };
};

const normalizeEmbedding = (value: unknown): Float32Array => {
  if (!value || typeof value !== "object" || !("data" in value)) {
    throw new Error("The model did not return an embedding tensor.");
  }

  const data = (value as { data: unknown }).data;
  if (!data || typeof data !== "object" || !("length" in data)) {
    throw new Error("The model returned an invalid embedding tensor.");
  }

  const values = data as ArrayLike<number>;
  if (values.length !== SEMANTIC_EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected a ${SEMANTIC_EMBEDDING_DIMENSION}-dimensional embedding, received ${values.length}.`,
    );
  }

  const normalized = new Float32Array(values.length);
  let squaredNorm = 0;

  for (let index = 0; index < values.length; index += 1) {
    const component = Number(values[index]);
    if (!Number.isFinite(component)) {
      throw new Error("The model returned a non-finite embedding component.");
    }
    normalized[index] = component;
    squaredNorm += component * component;
  }

  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("The model returned an embedding with zero magnitude.");
  }

  for (let index = 0; index < normalized.length; index += 1) {
    normalized[index] /= norm;
  }

  return normalized;
};

const createSkip = ({
  candidate,
  stage,
  reason,
}: {
  candidate: SemanticEmbeddingCandidate;
  stage: SemanticBuildSkip["stage"];
  reason: string;
}): SemanticBuildSkip => ({
  mediaId: candidate.mediaId,
  url: candidate.url,
  stage,
  reason,
});

const getImageForEmbedding = async ({
  candidate,
  signal,
}: {
  candidate: SemanticEmbeddingCandidate;
  signal: AbortSignal;
}): Promise<CachedSemanticImage> => {
  const cachedImage = cachedImages.get({
    url: candidate.url,
    contentHash: candidate.contentHash,
  });
  if (cachedImage) {
    return cachedImage;
  }

  return fetchImage({ url: candidate.url, signal });
};

const embedOneImage = async ({
  candidate,
  models,
  signal,
}: {
  candidate: SemanticEmbeddingCandidate;
  models: LoadedModels;
  signal: AbortSignal;
}): Promise<{
  embedding?: SemanticImageEmbedding;
  skip?: SemanticBuildSkip;
}> => {
  let cachedImage: CachedSemanticImage;

  try {
    cachedImage = await getImageForEmbedding({ candidate, signal });
  } catch (error) {
    return {
      skip: createSkip({
        candidate,
        stage:
          error instanceof Error && error.name === "HashError"
            ? "hash"
            : "fetch",
        reason: getErrorMessage(error),
      }),
    };
  }

  if (cachedImage.contentHash !== candidate.contentHash) {
    return {
      skip: createSkip({
        candidate,
        stage: "hash",
        reason: "The image bytes changed between hashing and embedding.",
      }),
    };
  }

  let image: RawImage;
  try {
    image = await RawImage.read(cachedImage.blob);
    throwIfAborted(signal);
  } catch (error) {
    return {
      skip: createSkip({
        candidate,
        stage: "decode",
        reason: `The fetched image could not be decoded: ${getErrorMessage(error)}`,
      }),
    };
  }

  try {
    const imageInputs = await models.processor(image);
    const output = await models.visionModel(imageInputs);
    throwIfAborted(signal);
    const outputRecord = output as Record<string, unknown>;
    return {
      embedding: {
        mediaId: candidate.mediaId,
        url: candidate.url,
        vector: normalizeEmbedding(outputRecord.image_embeds),
      },
    };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return {
      skip: createSkip({
        candidate,
        stage: "embedding",
        reason: `Image inference failed: ${getErrorMessage(error)}`,
      }),
    };
  }
};

const embedImages = async ({
  candidates,
  signal,
  onProgress,
}: {
  candidates: SemanticEmbeddingCandidate[];
  signal: AbortSignal;
  onProgress: ProgressReporter;
}): Promise<SemanticEmbedImagesResult> => {
  if (candidates.length === 0) {
    onProgress({ phase: "embedding", completed: 0, total: 0 });
    return { embeddings: [], skipped: [] };
  }

  const embeddings: SemanticImageEmbedding[] = [];
  const skipped: SemanticBuildSkip[] = [];

  try {
    const models = await initializeModels({ onProgress, signal });
    onProgress({
      phase: "embedding",
      completed: 0,
      total: candidates.length,
    });

    for (let index = 0; index < candidates.length; index += 1) {
      throwIfAborted(signal);
      const candidate = candidates[index];
      const result = await embedOneImage({ candidate, models, signal });

      if (result.embedding) {
        embeddings.push(result.embedding);
      } else if (result.skip) {
        skipped.push(result.skip);
      }

      onProgress({
        phase: "embedding",
        completed: index + 1,
        total: candidates.length,
        message: candidate.fileName,
      });
    }
  } finally {
    candidates.forEach(({ url }) => releaseCachedImage({ url }));
  }

  return { embeddings, skipped };
};

const embedText = async ({
  query,
  models,
  signal,
}: {
  query: string;
  models: LoadedModels;
  signal: AbortSignal;
}): Promise<Float32Array> => {
  const textInputs = models.tokenizer([query], {
    padding: "max_length",
    truncation: true,
  });
  const output = await models.textModel(textInputs);
  throwIfAborted(signal);
  const outputRecord = output as Record<string, unknown>;
  return normalizeEmbedding(outputRecord.text_embeds);
};

const search = async ({
  query,
  embeddings,
  dimension,
  limit,
  signal,
  onProgress,
}: {
  query: string;
  embeddings: Float32Array;
  dimension: number;
  limit: number;
  signal: AbortSignal;
  onProgress: ProgressReporter;
}): Promise<SemanticScoredRow[]> => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("A non-empty semantic search query is required.");
  }
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("The embedding dimension must be a positive integer.");
  }
  if (dimension !== SEMANTIC_EMBEDDING_DIMENSION) {
    throw new Error(
      `The stored index has dimension ${dimension}; expected ${SEMANTIC_EMBEDDING_DIMENSION}.`,
    );
  }
  if (embeddings.length % dimension !== 0) {
    throw new Error(
      "The embedding matrix length is not divisible by its dimension.",
    );
  }
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("The search result limit must be a non-negative number.");
  }
  if (limit === 0 || embeddings.length === 0) {
    onProgress({ phase: "searching", completed: 0, total: 0 });
    return [];
  }

  const models = await initializeModels({ onProgress, signal });
  const queryEmbedding = await embedText({
    query: normalizedQuery,
    models,
    signal,
  });
  return rankEmbeddingsByDotProduct({
    queryEmbedding,
    embeddings,
    dimension,
    limit,
    signal,
    onProgress,
  });
};

const postProgress = ({
  requestId,
  progress,
}: {
  requestId: string;
  progress: SemanticProgress;
}): void => {
  workerScope.postMessage({ requestId, type: "progress", progress });
};

const postResponse = (
  response: SemanticWorkerResponse,
  transfer?: Transferable[],
): void => {
  workerScope.postMessage(response, transfer);
};

const handleRequest = async (request: SemanticWorkerRequest): Promise<void> => {
  if (request.type === "cancel") {
    activeRequests.get(request.requestId)?.abort();
    cachedImages.clear();
    return;
  }

  const controller = new AbortController();
  activeRequests.set(request.requestId, controller);
  const onProgress: ProgressReporter = (progress) => {
    if (!controller.signal.aborted) {
      postProgress({ requestId: request.requestId, progress });
    }
  };

  try {
    switch (request.type) {
      case "initialize": {
        await initializeModels({
          onProgress,
          signal: controller.signal,
          reportReadyWhenCached: true,
        });
        postResponse({
          requestId: request.requestId,
          type: "initialized",
          model: SEMANTIC_MODEL_INFO,
        });
        break;
      }
      case "fetchAndHash": {
        onProgress({
          phase: "hashing",
          completed: 0,
          total: 1,
          message: request.url,
        });
        const result = await fetchAndHash({
          url: request.url,
          knownContentHash: request.knownContentHash,
          signal: controller.signal,
        });
        onProgress({
          phase: "hashing",
          completed: 1,
          total: 1,
          message: request.url,
        });
        postResponse({
          requestId: request.requestId,
          type: "fetchAndHashResult",
          result,
        });
        break;
      }
      case "embedImages": {
        const result = await embedImages({
          candidates: request.candidates,
          signal: controller.signal,
          onProgress,
        });
        postResponse(
          {
            requestId: request.requestId,
            type: "embedImagesResult",
            result,
          },
          result.embeddings.map(({ vector }) => vector.buffer as ArrayBuffer),
        );
        break;
      }
      case "search": {
        const results = await search({
          query: request.query,
          embeddings: request.embeddings,
          dimension: request.dimension,
          limit: request.limit,
          signal: controller.signal,
          onProgress,
        });
        postResponse({
          requestId: request.requestId,
          type: "searchResult",
          results,
        });
        break;
      }
    }
  } catch (error) {
    if (request.type === "initialize") {
      cachedImages.clear();
    }
    if (!controller.signal.aborted) {
      postResponse({
        requestId: request.requestId,
        type: "error",
        error: serializeError(error),
      });
    }
  } finally {
    if (controller.signal.aborted) {
      cachedImages.clear();
    }
    activeRequests.delete(request.requestId);
  }
};

workerScope.addEventListener("message", (event) => {
  void handleRequest(event.data);
});
