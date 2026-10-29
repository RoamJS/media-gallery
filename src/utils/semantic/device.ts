export type SemanticInferenceDevice = "webgpu" | "wasm";

type SemanticGpu = {
  requestAdapter: () => Promise<unknown | null>;
};

export type SemanticNavigator = {
  gpu?: SemanticGpu;
};

const getRuntimeNavigator = (): SemanticNavigator | null =>
  typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & SemanticNavigator);

export const selectSemanticInferenceDevice = async ({
  runtimeNavigator = getRuntimeNavigator(),
}: {
  runtimeNavigator?: SemanticNavigator | null;
} = {}): Promise<SemanticInferenceDevice> => {
  const requestAdapter = runtimeNavigator?.gpu?.requestAdapter;
  if (!requestAdapter) {
    return "wasm";
  }

  try {
    const adapter = await requestAdapter.call(runtimeNavigator.gpu);
    return adapter ? "webgpu" : "wasm";
  } catch (_error) {
    return "wasm";
  }
};
