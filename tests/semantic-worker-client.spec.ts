import { expect, test } from "@playwright/test";

import {
  createSemanticWorkerClient,
  getExtensionScriptUrl,
  resolveSemanticWorkerUrl,
} from "../src/utils/semantic/workerClient";
import {
  SEMANTIC_MODEL_INFO,
  type SemanticWorkerRequest,
  type SemanticWorkerResponse,
} from "../src/types/semantic";

class FakeWorker {
  onmessage: Worker["onmessage"] = null;
  onerror: Worker["onerror"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  readonly requests: SemanticWorkerRequest[] = [];
  onRequest?: (request: SemanticWorkerRequest) => void;
  terminated = false;

  postMessage(message: SemanticWorkerRequest): void {
    this.requests.push(message);
    this.onRequest?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: SemanticWorkerResponse): void {
    this.onmessage?.call(
      this as unknown as Worker,
      { data: response } as MessageEvent<SemanticWorkerResponse>,
    );
  }
}

const createHarness = () => {
  const fakeWorker = new FakeWorker();
  const fetchedUrls: string[] = [];
  const createdWorkers: Array<{ url: string; options: WorkerOptions }> = [];
  const workers: FakeWorker[] = [];
  const revokedUrls: string[] = [];
  const client = createSemanticWorkerClient({
    moduleUrl: "https://extensions.example/media-gallery/extension.js?v=1",
    fetchWorker: async (input) => {
      fetchedUrls.push(String(input));
      return new Response("export {};", {
        status: 200,
        headers: { "content-type": "text/javascript" },
      });
    },
    createObjectUrl: () => "blob:https://roam.example/semantic-worker",
    revokeObjectUrl: (url) => revokedUrls.push(url),
    createWorker: (url, options) => {
      createdWorkers.push({ url, options });
      const nextWorker = workers.length === 0 ? fakeWorker : new FakeWorker();
      workers.push(nextWorker);
      return nextWorker as unknown as Worker;
    },
  });

  return {
    client,
    fakeWorker,
    fetchedUrls,
    createdWorkers,
    workers,
    revokedUrls,
  };
};

test("resolves semantic.js beside the extension module with current-script fallback", () => {
  expect(
    resolveSemanticWorkerUrl({
      moduleUrl:
        "https://cdn.example/extensions/media-gallery/extension.js?v=2",
    }),
  ).toBe("https://cdn.example/extensions/media-gallery/semantic.js");

  expect(
    resolveSemanticWorkerUrl({
      moduleUrl: "blob:https://roam.example/opaque-id",
      currentScriptUrl:
        "https://cdn.example/extensions/media-gallery/extension.js?v=2",
    }),
  ).toBe("https://cdn.example/extensions/media-gallery/semantic.js");
});

test("captures the current extension script and can find a loaded extension asset", () => {
  expect(
    getExtensionScriptUrl({
      currentScript: {
        src: "https://cdn.example/media-gallery/extension.js?v=current",
      },
      scripts: [],
    } as unknown as Document),
  ).toBe("https://cdn.example/media-gallery/extension.js?v=current");

  expect(
    getExtensionScriptUrl({
      currentScript: null,
      scripts: [
        { src: "https://roam.example/app.js" },
        { src: "https://cdn.example/media-gallery/extension.js?v=loaded" },
      ],
    } as unknown as Document),
  ).toBe("https://cdn.example/media-gallery/extension.js?v=loaded");
});

test("lazily creates a Blob module worker and forwards progress", async () => {
  const { client, fakeWorker, fetchedUrls, createdWorkers } = createHarness();
  const progressMessages: string[] = [];
  expect(fetchedUrls).toHaveLength(0);

  fakeWorker.onRequest = (request) => {
    if (request.type !== "initialize") {
      return;
    }
    queueMicrotask(() => {
      fakeWorker.respond({
        requestId: request.requestId,
        type: "progress",
        progress: {
          phase: "initializing",
          completed: 50,
          total: 100,
          message: "Downloading model",
        },
      });
      fakeWorker.respond({
        requestId: request.requestId,
        type: "initialized",
        model: SEMANTIC_MODEL_INFO,
      });
    });
  };

  const model = await client.initialize({
    onProgress: ({ message }) => {
      if (message) {
        progressMessages.push(message);
      }
    },
  });

  expect(model).toEqual(SEMANTIC_MODEL_INFO);
  expect(progressMessages).toEqual(["Downloading model"]);
  expect(fetchedUrls).toEqual([
    "https://extensions.example/media-gallery/semantic.js",
  ]);
  expect(createdWorkers).toEqual([
    {
      url: "blob:https://roam.example/semantic-worker",
      options: { type: "module", name: "media-gallery-semantic" },
    },
  ]);
});

test("uses the embedded worker when a sibling asset cannot be resolved", async () => {
  const fakeWorker = new FakeWorker();
  const fetchedUrls: string[] = [];
  const blobParts: BlobPart[][] = [];
  const inlineWorkerSource = `export const worker = ${JSON.stringify("x".repeat(1_100))};`;
  const client = createSemanticWorkerClient({
    moduleUrl: "blob:https://roam.example/opaque-extension",
    currentScriptUrl: null,
    inlineWorkerSource,
    fetchWorker: async (input) => {
      fetchedUrls.push(String(input));
      return new Response(null, { status: 404 });
    },
    createObjectUrl: (blob) => {
      blobParts.push([blob]);
      return "blob:https://roam.example/inline-semantic-worker";
    },
    createWorker: () => fakeWorker as unknown as Worker,
  });

  fakeWorker.onRequest = (request) => {
    if (request.type === "initialize") {
      queueMicrotask(() => {
        fakeWorker.respond({
          requestId: request.requestId,
          type: "initialized",
          model: SEMANTIC_MODEL_INFO,
        });
      });
    }
  };

  await expect(client.initialize()).resolves.toEqual(SEMANTIC_MODEL_INFO);
  expect(fetchedUrls).toHaveLength(0);
  expect(blobParts).toHaveLength(1);
  await expect((blobParts[0][0] as Blob).text()).resolves.toBe(
    inlineWorkerSource,
  );
});

test("correlates out-of-order responses and preserves worker errors", async () => {
  const { client, fakeWorker } = createHarness();
  const fetchRequests: Extract<
    SemanticWorkerRequest,
    { type: "fetchAndHash" }
  >[] = [];
  fakeWorker.onRequest = (request) => {
    if (request.type !== "fetchAndHash") {
      return;
    }
    fetchRequests.push(request);
    if (fetchRequests.length !== 2) {
      return;
    }

    queueMicrotask(() => {
      const [first, second] = fetchRequests;
      fakeWorker.respond({
        requestId: second.requestId,
        type: "fetchAndHashResult",
        result: { contentHash: "hash-b", unchanged: false },
      });
      fakeWorker.respond({
        requestId: first.requestId,
        type: "error",
        error: {
          name: "CorsError",
          message: "Image host blocked cross-origin access",
        },
      });
    });
  };

  const first = client.fetchAndHash({ url: "https://images.example/a.jpg" });
  const second = client.fetchAndHash({ url: "https://images.example/b.jpg" });

  await expect(second).resolves.toEqual({
    contentHash: "hash-b",
    unchanged: false,
  });
  await expect(first).rejects.toMatchObject({
    name: "CorsError",
    message: "Image host blocked cross-origin access",
  });
});

for (const operation of ["initialize", "embedImages", "search"] as const) {
  test(`cancelling ${operation} terminates shared work and permits a fresh worker`, async () => {
    const { client, fakeWorker, workers, revokedUrls } = createHarness();
    const controller = new AbortController();
    const progressMessages: string[] = [];
    const options = {
      signal: controller.signal,
      onProgress: ({ message }: { message?: string }): void => {
        if (message) {
          progressMessages.push(message);
        }
      },
    };
    const cancelled =
      operation === "initialize"
        ? client.initialize(options)
        : operation === "embedImages"
          ? client.embedImages({ ...options, candidates: [] })
          : client.search({
              ...options,
              query: "diagram",
              embeddings: new Float32Array(512),
              dimension: 512,
              limit: 10,
            });
    const shared = client.fetchAndHash({
      url: "https://images.example/shared.jpg",
    });
    const rejectedCancelled = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    const rejectedShared = expect(shared).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect.poll(() => fakeWorker.requests.length).toBe(2);
    const oldMessageHandler = fakeWorker.onmessage;
    const cancelledRequest = fakeWorker.requests[0];
    controller.abort();

    await Promise.all([rejectedCancelled, rejectedShared]);
    expect(fakeWorker.terminated).toBe(true);
    expect(fakeWorker.onmessage).toBeNull();
    expect(revokedUrls).toEqual(["blob:https://roam.example/semantic-worker"]);

    const retried = client.initialize();
    await expect.poll(() => workers[1]?.requests.length).toBe(1);
    oldMessageHandler?.call(
      fakeWorker as unknown as Worker,
      {
        data: {
          requestId: cancelledRequest.requestId,
          type: "progress",
          progress: {
            phase: "initializing",
            completed: 1,
            total: 1,
            message: "Late progress from cancelled worker",
          },
        },
      } as MessageEvent<SemanticWorkerResponse>,
    );
    workers[1].respond({
      requestId: workers[1].requests[0].requestId,
      type: "initialized",
      model: SEMANTIC_MODEL_INFO,
    });
    await expect(retried).resolves.toEqual(SEMANTIC_MODEL_INFO);
    expect(progressMessages).toEqual([]);
    expect(workers[1].terminated).toBe(false);
    client.terminate();
  });
}

test("cancel during worker download settles immediately and cannot revive the old worker", async () => {
  const workers: FakeWorker[] = [];
  const downloads: Array<{
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
  }> = [];
  const client = createSemanticWorkerClient({
    moduleUrl: "https://extensions.example/media-gallery/extension.js",
    inlineWorkerSource: "x".repeat(1_100),
    fetchWorker: (_input, options) =>
      new Promise<Response>((resolve) => {
        downloads.push({ signal: options?.signal, resolve });
      }),
    createObjectUrl: () => `blob:download-${workers.length + 1}`,
    revokeObjectUrl: () => undefined,
    createWorker: () => {
      const nextWorker = new FakeWorker();
      workers.push(nextWorker);
      return nextWorker as unknown as Worker;
    },
  });
  const controller = new AbortController();
  const cancelled = client.initialize({ signal: controller.signal });
  const shared = client.fetchAndHash({ url: "https://images.example/a.jpg" });
  const rejectedCancelled = expect(cancelled).rejects.toMatchObject({
    name: "AbortError",
  });
  const rejectedShared = expect(shared).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(downloads).toHaveLength(1);
  controller.abort();
  await Promise.all([rejectedCancelled, rejectedShared]);
  expect(downloads[0].signal?.aborted).toBe(true);
  expect(workers).toHaveLength(0);

  const retried = client.initialize();
  expect(downloads).toHaveLength(2);
  // Simulate a download implementation that finishes despite its aborted signal.
  downloads[0].resolve(new Response("export {};"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(workers).toHaveLength(0);
  const joined = client.initialize();
  expect(downloads).toHaveLength(2);
  downloads[1].resolve(new Response("export {};"));
  await expect.poll(() => workers[0]?.requests.length).toBe(2);
  workers[0].requests.forEach(({ requestId }) => {
    workers[0].respond({
      requestId,
      type: "initialized",
      model: SEMANTIC_MODEL_INFO,
    });
  });
  await expect(retried).resolves.toEqual(SEMANTIC_MODEL_INFO);
  await expect(joined).resolves.toEqual(SEMANTIC_MODEL_INFO);
  expect(workers).toHaveLength(1);
  client.terminate();
});

test("rejects pending work on permanent termination", async () => {
  const { client, fakeWorker, revokedUrls } = createHarness();
  const pendingFetch = client.fetchAndHash({
    url: "https://images.example/pending.jpg",
  });
  await expect
    .poll(
      () =>
        fakeWorker.requests.filter(({ type }) => type === "fetchAndHash")
          .length,
    )
    .toBe(1);
  client.terminate();

  await expect(pendingFetch).rejects.toMatchObject({
    name: "SemanticWorkerTerminatedError",
  });
  expect(fakeWorker.terminated).toBe(true);
  expect(revokedUrls).toEqual(["blob:https://roam.example/semantic-worker"]);
});

for (const failure of ["error", "messageerror"] as const) {
  test(`recreates a failed worker after ${failure} and ignores its late events`, async () => {
    const workers: FakeWorker[] = [];
    const revokedUrls: string[] = [];
    let objectUrlCount = 0;
    const client = createSemanticWorkerClient({
      moduleUrl: "https://extensions.example/media-gallery/extension.js",
      fetchWorker: async () => new Response("export {};"),
      createObjectUrl: () => `blob:worker-${++objectUrlCount}`,
      revokeObjectUrl: (url) => revokedUrls.push(url),
      createWorker: () => {
        const nextWorker = new FakeWorker();
        workers.push(nextWorker);
        return nextWorker as unknown as Worker;
      },
    });
    const pending = client.initialize();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "SemanticWorkerError",
    });
    await expect.poll(() => workers[0]?.requests.length).toBe(1);
    const failedWorker = workers[0];
    const oldErrorHandler = failedWorker.onerror;
    if (failure === "error") {
      failedWorker.onerror?.call(
        failedWorker as unknown as Worker,
        { message: "Worker crashed" } as ErrorEvent,
      );
    } else {
      failedWorker.onmessageerror?.call(
        failedWorker as unknown as Worker,
        {} as MessageEvent,
      );
    }
    await rejected;
    expect(failedWorker.terminated).toBe(true);
    expect(revokedUrls).toEqual(["blob:worker-1"]);

    const retried = client.initialize();
    await expect.poll(() => workers[1]?.requests.length).toBe(1);
    oldErrorHandler?.call(
      failedWorker as unknown as Worker,
      { message: "Late old-worker error" } as ErrorEvent,
    );
    workers[1].respond({
      requestId: workers[1].requests[0].requestId,
      type: "initialized",
      model: SEMANTIC_MODEL_INFO,
    });
    await expect(retried).resolves.toEqual(SEMANTIC_MODEL_INFO);
    expect(workers[1].terminated).toBe(false);
    client.terminate();
    expect(revokedUrls).toEqual(["blob:worker-1", "blob:worker-2"]);
  });
}

test("revokes a failed worker-constructor URL and allows another attempt", async () => {
  const worker = new FakeWorker();
  const revokedUrls: string[] = [];
  let created = 0;
  const client = createSemanticWorkerClient({
    moduleUrl: "https://extensions.example/media-gallery/extension.js",
    fetchWorker: async () => new Response("export {};"),
    createObjectUrl: () => `blob:constructor-${created + 1}`,
    revokeObjectUrl: (url) => revokedUrls.push(url),
    createWorker: () => {
      created += 1;
      if (created === 1) {
        throw new Error("Worker construction failed");
      }
      return worker as unknown as Worker;
    },
  });
  await expect(client.initialize()).rejects.toThrow(
    "Worker construction failed",
  );
  expect(revokedUrls).toEqual(["blob:constructor-1"]);
  worker.onRequest = (request) => {
    if (request.type === "initialize") {
      worker.respond({
        requestId: request.requestId,
        type: "initialized",
        model: SEMANTIC_MODEL_INFO,
      });
    }
  };
  await expect(client.initialize()).resolves.toEqual(SEMANTIC_MODEL_INFO);
  client.terminate();
  expect(revokedUrls).toEqual(["blob:constructor-1", "blob:constructor-2"]);
});
