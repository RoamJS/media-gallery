import type {
  SemanticProgressCallback,
  SemanticWorkerClient,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from "~/types/semantic";

type SemanticWorkerSuccessResponse = Exclude<
  SemanticWorkerResponse,
  { type: "progress" | "error" }
>;

type PendingRequest = {
  resolve: (response: SemanticWorkerSuccessResponse) => void;
  reject: (error: Error) => void;
  onProgress?: SemanticProgressCallback;
  removeAbortListener?: () => void;
};

export type SemanticWorkerClientOptions = {
  moduleUrl?: string;
  currentScriptUrl?: string | null;
  inlineWorkerSource?: string;
  fetchWorker?: typeof fetch;
  createWorker?: (url: string, options: WorkerOptions) => Worker;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
};

const INLINE_SEMANTIC_WORKER_SOURCE =
  "__MEDIA_GALLERY_INLINE_SEMANTIC_WORKER_SOURCE__";

export const getExtensionScriptUrl = (
  sourceDocument: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): string | null => {
  if (!sourceDocument) {
    return null;
  }

  const currentScript =
    sourceDocument.currentScript as HTMLScriptElement | null;
  if (currentScript?.src) {
    return currentScript.src;
  }

  const extensionScript = Array.from(sourceDocument.scripts)
    .reverse()
    .find(({ src }) => /\/extension\.js(?:[?#].*)?$/.test(src));
  return extensionScript?.src || null;
};

const CAPTURED_EXTENSION_SCRIPT_URL = getExtensionScriptUrl();

const canResolveSibling = (candidate: string): boolean => {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol !== "blob:" && protocol !== "data:";
  } catch {
    return false;
  }
};

export const resolveSemanticWorkerUrl = ({
  moduleUrl,
  currentScriptUrl,
}: {
  moduleUrl?: string | null;
  currentScriptUrl?: string | null;
}): string => {
  const baseUrl =
    moduleUrl && canResolveSibling(moduleUrl)
      ? moduleUrl
      : currentScriptUrl && canResolveSibling(currentScriptUrl)
        ? currentScriptUrl
        : null;

  if (!baseUrl) {
    throw new Error(
      "Could not resolve semantic.js from the extension module or current script URL.",
    );
  }

  return new URL("semantic.js", baseUrl).href;
};

const createAbortError = (): Error => {
  const error = new Error("The semantic worker request was cancelled.");
  error.name = "AbortError";
  return error;
};

const deserializeWorkerError = ({
  name,
  message,
  stack,
}: {
  name: string;
  message: string;
  stack?: string;
}): Error => {
  const error = new Error(message);
  error.name = name;
  if (stack) {
    error.stack = stack;
  }
  return error;
};

export const createSemanticWorkerClient = (
  options: SemanticWorkerClientOptions = {},
): SemanticWorkerClient => {
  const fetchWorker = options.fetchWorker ?? globalThis.fetch.bind(globalThis);
  const createWorker =
    options.createWorker ??
    ((url: string, workerOptions: WorkerOptions): Worker =>
      new Worker(url, workerOptions));
  const createObjectUrl =
    options.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const revokeObjectUrl =
    options.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL);
  const pendingRequests = new Map<string, PendingRequest>();

  let requestCounter = 0;
  let worker: Worker | null = null;
  let workerPromise: Promise<Worker> | null = null;
  let workerObjectUrl: string | null = null;
  let workerInitialization: AbortController | null = null;
  let terminated = false;

  const getInlineWorkerSource = (): string | null => {
    const source = options.inlineWorkerSource ?? INLINE_SEMANTIC_WORKER_SOURCE;
    return source.length > 1_000 ? source : null;
  };

  const loadWorkerSource = async (signal: AbortSignal): Promise<BlobPart> => {
    try {
      const workerAssetUrl = resolveSemanticWorkerUrl({
        moduleUrl: options.moduleUrl,
        currentScriptUrl:
          options.currentScriptUrl ??
          CAPTURED_EXTENSION_SCRIPT_URL ??
          getExtensionScriptUrl(),
      });
      const response = await fetchWorker(workerAssetUrl, {
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) {
        throw new Error(
          `Could not load semantic.js (${response.status} ${response.statusText || "HTTP error"}).`,
        );
      }
      return await response.blob();
    } catch (error) {
      if (signal.aborted) {
        throw createAbortError();
      }
      const inlineWorkerSource = getInlineWorkerSource();
      if (inlineWorkerSource) {
        return inlineWorkerSource;
      }
      throw error;
    }
  };

  const rejectPendingRequests = (error: Error): void => {
    pendingRequests.forEach((pending) => {
      pending.removeAbortListener?.();
      pending.reject(error);
    });
    pendingRequests.clear();
  };

  const handleWorkerMessage = (
    event: MessageEvent<SemanticWorkerResponse>,
  ): void => {
    const response = event.data;
    const pending = pendingRequests.get(response.requestId);
    if (!pending) {
      return;
    }

    if (response.type === "progress") {
      pending.onProgress?.(response.progress);
      return;
    }

    pendingRequests.delete(response.requestId);
    pending.removeAbortListener?.();

    if (response.type === "error") {
      pending.reject(deserializeWorkerError(response.error));
      return;
    }

    pending.resolve(response);
  };

  const releaseWorker = (): void => {
    workerInitialization?.abort();
    workerInitialization = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    workerPromise = null;
    if (workerObjectUrl) {
      revokeObjectUrl(workerObjectUrl);
      workerObjectUrl = null;
    }
  };

  const handleWorkerFailure = ({
    failedWorker,
    message,
  }: {
    failedWorker: Worker;
    message: string;
  }): void => {
    if (worker !== failedWorker) {
      return;
    }
    const error = new Error(message || "The semantic worker failed.");
    error.name = "SemanticWorkerError";
    releaseWorker();
    rejectPendingRequests(error);
  };

  const initializeWorker = async (signal: AbortSignal): Promise<Worker> => {
    if (terminated) {
      throw new Error("The semantic worker client has been terminated.");
    }

    const source = await loadWorkerSource(signal);
    if (terminated) {
      throw new Error("The semantic worker client has been terminated.");
    }
    if (signal.aborted) {
      throw createAbortError();
    }
    const moduleBlob = new Blob([source], { type: "text/javascript" });
    const objectUrl = createObjectUrl(moduleBlob);
    let createdWorker: Worker;
    try {
      createdWorker = createWorker(objectUrl, {
        type: "module",
        name: "media-gallery-semantic",
      });
    } catch (error) {
      revokeObjectUrl(objectUrl);
      throw error;
    }
    createdWorker.onmessage = handleWorkerMessage;
    createdWorker.onerror = (event): void => {
      handleWorkerFailure({
        failedWorker: createdWorker,
        message: event.message,
      });
    };
    createdWorker.onmessageerror = (): void => {
      handleWorkerFailure({
        failedWorker: createdWorker,
        message: "The semantic worker returned an unreadable message.",
      });
    };

    if (terminated || signal.aborted) {
      createdWorker.terminate();
      revokeObjectUrl(objectUrl);
      if (signal.aborted) {
        throw createAbortError();
      }
      throw new Error("The semantic worker client has been terminated.");
    }

    workerObjectUrl = objectUrl;
    worker = createdWorker;
    return createdWorker;
  };

  const getWorker = (): Promise<Worker> => {
    if (worker) {
      return Promise.resolve(worker);
    }
    if (workerPromise) {
      return workerPromise;
    }

    const initialization = new AbortController();
    workerInitialization = initialization;
    const initializationPromise = initializeWorker(initialization.signal).catch(
      (error: unknown) => {
        if (workerPromise === initializationPromise) {
          workerPromise = null;
          workerInitialization = null;
        }
        throw error;
      },
    );
    workerPromise = initializationPromise;
    return workerPromise;
  };

  const request = async ({
    buildRequest,
    onProgress,
    signal,
  }: {
    buildRequest: (requestId: string) => SemanticWorkerRequest;
    onProgress?: SemanticProgressCallback;
    signal?: AbortSignal;
  }): Promise<SemanticWorkerSuccessResponse> => {
    if (signal?.aborted) {
      throw createAbortError();
    }

    requestCounter += 1;
    const requestId = `semantic-${requestCounter}`;
    const workerRequest = buildRequest(requestId);

    return new Promise<SemanticWorkerSuccessResponse>((resolve, reject) => {
      const handleAbort = (): void => {
        if (!pendingRequests.has(requestId)) {
          return;
        }
        // Model loading and inference cannot be interrupted cooperatively. All
        // requests share one worker, so cancelling one must settle all of them.
        releaseWorker();
        rejectPendingRequests(createAbortError());
      };
      const removeAbortListener = signal
        ? (): void => signal.removeEventListener("abort", handleAbort)
        : undefined;

      pendingRequests.set(requestId, {
        resolve,
        reject,
        onProgress,
        removeAbortListener,
      });
      signal?.addEventListener("abort", handleAbort, { once: true });

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      void getWorker()
        .then((targetWorker) => {
          if (pendingRequests.has(requestId)) {
            targetWorker.postMessage(workerRequest);
          }
        })
        .catch((error: unknown) => {
          const pending = pendingRequests.get(requestId);
          if (!pending) {
            return;
          }
          pendingRequests.delete(requestId);
          pending.removeAbortListener?.();
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
  };

  return {
    initialize: async ({ onProgress, signal } = {}) => {
      const response = await request({
        buildRequest: (requestId) => ({ requestId, type: "initialize" }),
        onProgress,
        signal,
      });
      if (response.type !== "initialized") {
        throw new Error(
          `Unexpected semantic worker response: ${response.type}`,
        );
      }
      return response.model;
    },
    fetchAndHash: async ({ url, knownContentHash, signal }) => {
      const response = await request({
        buildRequest: (requestId) => ({
          requestId,
          type: "fetchAndHash",
          url,
          ...(knownContentHash ? { knownContentHash } : {}),
        }),
        signal,
      });
      if (response.type !== "fetchAndHashResult") {
        throw new Error(
          `Unexpected semantic worker response: ${response.type}`,
        );
      }
      return response.result;
    },
    embedImages: async ({ candidates, onProgress, signal }) => {
      const response = await request({
        buildRequest: (requestId) => ({
          requestId,
          type: "embedImages",
          candidates,
        }),
        onProgress,
        signal,
      });
      if (response.type !== "embedImagesResult") {
        throw new Error(
          `Unexpected semantic worker response: ${response.type}`,
        );
      }
      return response.result;
    },
    search: async ({
      query,
      embeddings,
      dimension,
      limit,
      onProgress,
      signal,
    }) => {
      const response = await request({
        buildRequest: (requestId) => ({
          requestId,
          type: "search",
          query,
          embeddings,
          dimension,
          limit,
        }),
        onProgress,
        signal,
      });
      if (response.type !== "searchResult") {
        throw new Error(
          `Unexpected semantic worker response: ${response.type}`,
        );
      }
      return response.results;
    },
    terminate: (): void => {
      if (terminated) {
        return;
      }

      terminated = true;
      const error = new Error("The semantic worker client was terminated.");
      error.name = "SemanticWorkerTerminatedError";
      rejectPendingRequests(error);
      releaseWorker();
    },
  };
};

export default createSemanticWorkerClient;
