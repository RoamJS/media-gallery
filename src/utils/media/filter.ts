import type { SemanticSearchResult } from "~/types/semantic";

import type { MediaFilters, MediaItem } from "~/types/media";

const getDayStart = (value: string): number | null => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00`);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const getDayEnd = (value: string): number | null => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(`${value}T23:59:59.999`);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const inRange = ({
  value,
  from,
  to,
}: {
  value: number | null;
  from: number | null;
  to: number | null;
}): boolean => {
  if (value === null) {
    return false;
  }
  if (from !== null && value < from) {
    return false;
  }
  if (to !== null && value > to) {
    return false;
  }
  return true;
};

const queryMatches = ({
  item,
  query,
}: {
  item: MediaItem;
  query: string;
}): boolean => {
  if (!query) {
    return true;
  }
  const normalized = query.toLowerCase();
  return (
    item.fileName.toLowerCase().includes(normalized) ||
    item.url.toLowerCase().includes(normalized) ||
    item.searchText.toLowerCase().includes(normalized) ||
    item.authors.some((author) => author.toLowerCase().includes(normalized))
  );
};

const dateMatches = ({
  item,
  filters,
}: {
  item: MediaItem;
  filters: MediaFilters;
}): boolean => {
  const createdFrom = getDayStart(filters.createdFrom);
  const createdTo = getDayEnd(filters.createdTo);
  const updatedFrom = getDayStart(filters.updatedFrom);
  const updatedTo = getDayEnd(filters.updatedTo);

  const createdActive = createdFrom !== null || createdTo !== null;
  const updatedActive = updatedFrom !== null || updatedTo !== null;

  if (
    createdActive &&
    !inRange({ value: item.createdTime, from: createdFrom, to: createdTo })
  ) {
    return false;
  }
  if (
    updatedActive &&
    !inRange({ value: item.updatedTime, from: updatedFrom, to: updatedTo })
  ) {
    return false;
  }
  return true;
};

const sortItems = ({
  items,
  filters,
}: {
  items: MediaItem[];
  filters: MediaFilters;
}): MediaItem[] => {
  const dir = filters.sortDirection === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const aValue =
      filters.sortBy === "created"
        ? (a.createdTime ?? 0)
        : (a.updatedTime ?? 0);
    const bValue =
      filters.sortBy === "created"
        ? (b.createdTime ?? 0)
        : (b.updatedTime ?? 0);
    if (aValue !== bValue) {
      return (aValue - bValue) * dir;
    }
    return a.fileName.localeCompare(b.fileName);
  });
};

export const applyMediaFilters = ({
  items,
  filters,
}: {
  items: MediaItem[];
  filters: MediaFilters;
}): MediaItem[] => {
  const filtered = items.filter((item) => {
    if (!queryMatches({ item, query: filters.query })) {
      return false;
    }
    if (filters.author !== "all" && !item.authors.includes(filters.author)) {
      return false;
    }
    if (filters.mediaType !== "all" && item.mediaType !== filters.mediaType) {
      return false;
    }
    if (
      filters.orientation !== "all" &&
      item.orientation !== filters.orientation
    ) {
      return false;
    }
    if (!dateMatches({ item, filters })) {
      return false;
    }
    return true;
  });
  return sortItems({ items: filtered, filters });
};

// Rank the full index first so filters never discard matches below the display limit.
export const applySemanticResultFilters = ({
  results,
  items,
  filters,
}: {
  results: SemanticSearchResult[];
  items: MediaItem[];
  filters: MediaFilters;
}): SemanticSearchResult[] => {
  const allowedUrls = new Set(
    applyMediaFilters({ items, filters: { ...filters, query: "" } }).map(
      ({ url }) => url,
    ),
  );
  return results.filter(({ url }) => allowedUrls.has(url));
};
