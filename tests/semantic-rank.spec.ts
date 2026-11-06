import { expect, test } from "@playwright/test";

import { rankEmbeddingsByDotProduct } from "../src/utils/semantic/rank";

test("ranks exact dot products descending with stable row-index ties", () => {
  const progress: Array<[number, number]> = [];
  const results = rankEmbeddingsByDotProduct({
    queryEmbedding: new Float32Array([1, 0]),
    embeddings: new Float32Array([0.5, 0, 0.5, 1, 0.9, 0, -1, 0]),
    dimension: 2,
    limit: 3,
    onProgress: ({ completed, total }) => progress.push([completed, total]),
  });

  expect(results.map(({ index }) => index)).toEqual([2, 0, 1]);
  expect(results[0].score).toBeCloseTo(0.9);
  expect(results[1].score).toBe(0.5);
  expect(results[2].score).toBe(0.5);
  expect(progress).toEqual([
    [0, 4],
    [4, 4],
  ]);
});

test("validates dimensions, limits, and finite vector components", () => {
  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array(),
      embeddings: new Float32Array(),
      dimension: 0,
      limit: 1,
    }),
  ).toThrow("positive integer");

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([1]),
      embeddings: new Float32Array([1, 2]),
      dimension: 2,
      limit: 1,
    }),
  ).toThrow("query embedding has 1 components; expected 2");

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([1, 0]),
      embeddings: new Float32Array([1, 0, 1]),
      dimension: 2,
      limit: 1,
    }),
  ).toThrow("not divisible");

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([Number.NaN, 0]),
      embeddings: new Float32Array([1, 0]),
      dimension: 2,
      limit: 1,
    }),
  ).toThrow("query embedding contains a non-finite component");

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([1, 0]),
      embeddings: new Float32Array([Number.POSITIVE_INFINITY, 0]),
      dimension: 2,
      limit: 1,
    }),
  ).toThrow("Embedding row 0 contains a non-finite component");

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([1, 0]),
      embeddings: new Float32Array([1, 0]),
      dimension: 2,
      limit: -1,
    }),
  ).toThrow("non-negative");
});

test("honors cancellation before ranking", () => {
  const controller = new AbortController();
  controller.abort();

  expect(() =>
    rankEmbeddingsByDotProduct({
      queryEmbedding: new Float32Array([1, 0]),
      embeddings: new Float32Array([1, 0]),
      dimension: 2,
      limit: 1,
      signal: controller.signal,
    }),
  ).toThrow(expect.objectContaining({ name: "AbortError" }));
});
