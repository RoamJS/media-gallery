import { expect, test } from "@playwright/test";

import { selectSemanticInferenceDevice } from "../src/utils/semantic/device";

test("uses WebGPU only after obtaining a real adapter", async () => {
  let requestCount = 0;
  const device = await selectSemanticInferenceDevice({
    runtimeNavigator: {
      gpu: {
        requestAdapter: async () => {
          requestCount += 1;
          return { name: "test-adapter" };
        },
      },
    },
  });

  expect(device).toBe("webgpu");
  expect(requestCount).toBe(1);
});

test("selects WASM before ONNX initialization when no adapter is available", async () => {
  await expect(
    selectSemanticInferenceDevice({ runtimeNavigator: null }),
  ).resolves.toBe("wasm");
  await expect(
    selectSemanticInferenceDevice({ runtimeNavigator: {} }),
  ).resolves.toBe("wasm");
  await expect(
    selectSemanticInferenceDevice({
      runtimeNavigator: {
        gpu: { requestAdapter: async () => null },
      },
    }),
  ).resolves.toBe("wasm");
});

test("selects WASM when adapter probing throws", async () => {
  await expect(
    selectSemanticInferenceDevice({
      runtimeNavigator: {
        gpu: {
          requestAdapter: async () => {
            throw new Error("GPU access denied");
          },
        },
      },
    }),
  ).resolves.toBe("wasm");
});
