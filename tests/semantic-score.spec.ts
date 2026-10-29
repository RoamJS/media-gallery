import { expect, test } from "@playwright/test";

import { formatSimilarityScore } from "../src/utils/semantic/score";

test("formats cosine scores as percentages without shifting their meaning", () => {
  expect(formatSimilarityScore(0.0481054866983937)).toBe("4.8%");
  expect(formatSimilarityScore(0.02924416874075565)).toBe("2.9%");
  expect(formatSimilarityScore(0)).toBe("0.0%");
  expect(formatSimilarityScore(-0.123)).toBe("-12.3%");
  expect(formatSimilarityScore(1 + Number.EPSILON)).toBe("100.0%");
  expect(formatSimilarityScore(-1 - Number.EPSILON)).toBe("-100.0%");
});

test("omits missing or non-finite similarity values", () => {
  expect(formatSimilarityScore(undefined)).toBeNull();
  expect(formatSimilarityScore(Number.NaN)).toBeNull();
  expect(formatSimilarityScore(Number.POSITIVE_INFINITY)).toBeNull();
});
