import type { MediaFilters, MediaItem, MediaReference } from "~/types/media";

export const DEFAULT_FILTERS: MediaFilters = {
  query: "",
  author: "all",
  mediaType: "all",
  orientation: "all",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: "",
  sortBy: "updated",
  sortDirection: "desc",
};
export type ConstraintKey = Exclude<
  keyof MediaFilters,
  "query" | "sortBy" | "sortDirection"
>;
export const CONSTRAINT_LABELS: Record<ConstraintKey, string> = {
  author: "Block contributor",
  mediaType: "Type",
  orientation: "Orientation",
  createdFrom: "Earliest block created from",
  createdTo: "Earliest block created to",
  updatedFrom: "Latest block edited from",
  updatedTo: "Latest block edited to",
};
export const getActiveConstraints = (
  filters: MediaFilters,
): Array<{ key: ConstraintKey; label: string }> =>
  (Object.keys(CONSTRAINT_LABELS) as ConstraintKey[])
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key])
    .map((key) => ({
      key,
      label: `${CONSTRAINT_LABELS[key]}: ${filters[key]}`,
    }));
export const clearMediaConstraints = (filters: MediaFilters): MediaFilters => ({
  ...DEFAULT_FILTERS,
  query: filters.query,
  sortBy: filters.sortBy,
  sortDirection: filters.sortDirection,
});
export const getDateRangeError = (filters: MediaFilters): string => {
  if (
    filters.createdFrom &&
    filters.createdTo &&
    filters.createdFrom > filters.createdTo
  )
    return "The earliest block creation end date must be on or after its start date.";
  if (
    filters.updatedFrom &&
    filters.updatedTo &&
    filters.updatedFrom > filters.updatedTo
  )
    return "The latest block edit end date must be on or after its start date.";
  return "";
};
export const getReferenceEvents = (
  item: MediaItem,
): {
  first: MediaReference | null;
  latest: MediaReference | null;
  count: number;
} => {
  const references = [
    ...new Map(
      item.references.map((reference) => [reference.blockUid, reference]),
    ).values(),
  ];
  const first =
    references
      .filter((r) => r.createdTime !== null)
      .sort(
        (a, b) =>
          (a.createdTime as number) - (b.createdTime as number) ||
          a.blockUid.localeCompare(b.blockUid),
      )[0] || null;
  const latest =
    references
      .filter((r) => r.updatedTime !== null)
      .sort(
        (a, b) =>
          (b.updatedTime as number) - (a.updatedTime as number) ||
          a.blockUid.localeCompare(b.blockUid),
      )[0] || null;
  return { first, latest, count: references.length };
};
export const formatReferenceDate = (value: number | null): string =>
  value === null ? "Not available" : new Date(value).toLocaleString();
