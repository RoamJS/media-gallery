export const formatSimilarityScore = (
  score: number | undefined,
): string | null => {
  if (score === undefined || !Number.isFinite(score)) return null;
  return `${(Math.max(-1, Math.min(1, score)) * 100).toFixed(1)}%`;
};
