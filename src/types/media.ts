export type MediaType =
  | "image"
  | "gif"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "other";

export type Orientation = "landscape" | "portrait" | "square" | "unknown";

export type MediaReference = {
  blockUid: string;
  pageUid: string;
  createdTime: number | null;
  updatedTime: number | null;
  createdAuthor: string;
  updatedAuthor: string;
};

export type MediaItem = {
  id: string;
  url: string;
  fileName: string;
  extension: string;
  searchText: string;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  orientation: Orientation;
  createdTime: number | null;
  updatedTime: number | null;
  authors: string[];
  references: MediaReference[];
};

export type MediaFilters = {
  query: string;
  author: string;
  mediaType: "all" | MediaType;
  orientation: "all" | Orientation;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  sortBy: "created" | "updated";
  sortDirection: "asc" | "desc";
};

export type MediaFeedback = {
  id: string;
  message: string;
  url?: string;
  error?: boolean;
};
