import type {
  SemanticProgressCallback,
  SemanticScoredRow,
} from "~/types/semantic";

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new DOMException("Semantic ranking was cancelled.", "AbortError");
  }
};

export const rankEmbeddingsByDotProduct = ({
  queryEmbedding,
  embeddings,
  dimension,
  limit,
  signal,
  onProgress,
}: {
  queryEmbedding: Float32Array;
  embeddings: Float32Array;
  dimension: number;
  limit: number;
  signal?: AbortSignal;
  onProgress?: SemanticProgressCallback;
}): SemanticScoredRow[] => {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("The embedding dimension must be a positive integer.");
  }
  if (queryEmbedding.length !== dimension) {
    throw new Error(
      `The query embedding has ${queryEmbedding.length} components; expected ${dimension}.`,
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

  for (let component = 0; component < queryEmbedding.length; component += 1) {
    if (!Number.isFinite(queryEmbedding[component])) {
      throw new Error("The query embedding contains a non-finite component.");
    }
  }

  const rowCount = embeddings.length / dimension;
  const scoredRows: SemanticScoredRow[] = new Array(rowCount);
  onProgress?.({ phase: "searching", completed: 0, total: rowCount });

  for (let row = 0; row < rowCount; row += 1) {
    if (row % 128 === 0) {
      throwIfAborted(signal);
    }

    let score = 0;
    const offset = row * dimension;
    for (let component = 0; component < dimension; component += 1) {
      const candidateComponent = embeddings[offset + component];
      if (!Number.isFinite(candidateComponent)) {
        throw new Error(
          `Embedding row ${row} contains a non-finite component.`,
        );
      }
      score += queryEmbedding[component] * candidateComponent;
    }
    scoredRows[row] = { index: row, score };

    if ((row + 1) % 128 === 0 || row + 1 === rowCount) {
      onProgress?.({
        phase: "searching",
        completed: row + 1,
        total: rowCount,
      });
    }
  }

  scoredRows.sort((left, right) => {
    if (left.score === right.score) {
      return left.index - right.index;
    }
    return right.score - left.score;
  });

  return scoredRows.slice(0, Math.min(Math.floor(limit), rowCount));
};
