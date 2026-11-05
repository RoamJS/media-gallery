import type { MediaType, Orientation } from "~/types/media";

const MEDIA_HOSTS = new Set(["firebasestorage.googleapis.com"]);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

const GIF_EXTENSIONS = new Set(["gif"]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "m4v",
  "avi",
  "mkv",
  "ogv",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "aac",
  "opus",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

const DOCUMENT_EXTENSIONS = new Set([
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "json",
  "md",
]);

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const MARKDOWN_MEDIA_REGEX = /(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const ROAM_MEDIA_MACRO_REGEX =
  /\{\{\s*(?:\[\[)?(video|audio)(?:\]\])?\s*:\s*(https?:\/\/[^}\s]+)\s*\}\}/gi;

const TRAILING_CHARS = new Set([")", "]", "}", ">", ",", ".", ";", ":"]);

const stripTrailingChars = (raw: string): string => {
  let output = raw;
  while (output.length > 0 && TRAILING_CHARS.has(output[output.length - 1])) {
    output = output.slice(0, -1);
  }
  return output;
};

const toUrlOrNull = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch (_e) {
    return null;
  }
};

export const isRoamStorageUrl = (raw: string): boolean => {
  const url = toUrlOrNull(raw.trim());
  return Boolean(url && MEDIA_HOSTS.has(url.hostname));
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch (_e) {
    return value;
  }
};

const decodeFirebaseObjectPath = (url: URL): string => {
  if (!url.hostname.includes("firebasestorage.googleapis.com")) {
    return safeDecodeURIComponent(url.pathname.replace(/^\/+/, ""));
  }
  const idx = url.pathname.indexOf("/o/");
  if (idx < 0) {
    return safeDecodeURIComponent(url.pathname.replace(/^\/+/, ""));
  }
  const objectPath = url.pathname.slice(idx + 3);
  return safeDecodeURIComponent(objectPath);
};

export const getExtension = (fileName: string): string => {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0 || idx === fileName.length - 1) {
    return "";
  }
  return fileName.slice(idx + 1).toLowerCase();
};

export const classifyMediaType = ({
  extension,
  mimeType,
}: {
  extension: string;
  mimeType: string;
}): MediaType => {
  if (mimeType === "image/gif" || GIF_EXTENSIONS.has(extension)) {
    return "gif";
  }
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (mimeType === "application/pdf" || PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  return "other";
};

export const inferMimeType = ({
  mediaType,
  extension,
}: {
  mediaType: MediaType;
  extension: string;
}): string => {
  if (!extension) {
    return "application/octet-stream";
  }
  if (mediaType === "image") {
    return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  }
  if (mediaType === "gif") {
    return "image/gif";
  }
  if (mediaType === "video") {
    return `video/${extension}`;
  }
  if (mediaType === "audio") {
    return `audio/${extension}`;
  }
  if (mediaType === "pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
};

type MediaTypeHint = Extract<MediaType, "image" | "video" | "audio">;

const shouldKeepUrl = ({
  url,
  extension,
  mediaTypeHint,
}: {
  url: URL;
  extension: string;
  mediaTypeHint?: MediaTypeHint;
}): boolean => {
  if (mediaTypeHint) {
    return true;
  }
  if (MEDIA_HOSTS.has(url.hostname)) {
    return true;
  }
  if (
    IMAGE_EXTENSIONS.has(extension) ||
    GIF_EXTENSIONS.has(extension) ||
    VIDEO_EXTENSIONS.has(extension) ||
    AUDIO_EXTENSIONS.has(extension) ||
    PDF_EXTENSIONS.has(extension) ||
    DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return true;
  }
  return false;
};

export type ParsedMediaUrl = {
  url: string;
  fileName: string;
  extension: string;
  mediaType: MediaType;
  mimeType: string;
};

export type ParsedMediaReference = ParsedMediaUrl & {
  searchText: string;
  displayName: string;
};

export const parseMediaUrl = (
  raw: string,
  mediaTypeHint?: MediaTypeHint,
): ParsedMediaUrl | null => {
  const clean = stripTrailingChars(raw.trim());
  const parsed = toUrlOrNull(clean);
  if (!parsed) {
    return null;
  }
  const fullPath = decodeFirebaseObjectPath(parsed);
  const fileName = fullPath.split("/").pop() || parsed.hostname;
  const extension = getExtension(fileName);
  if (!shouldKeepUrl({ url: parsed, extension, mediaTypeHint })) {
    return null;
  }
  const classifiedMediaType = classifyMediaType({ extension, mimeType: "" });
  const mediaType =
    classifiedMediaType === "other" && mediaTypeHint
      ? mediaTypeHint
      : classifiedMediaType;
  const mimeType = inferMimeType({ mediaType, extension });
  return {
    url: clean,
    fileName,
    extension,
    mediaType,
    mimeType,
  };
};

const addSearchTerm = ({
  all,
  term,
}: {
  all: Set<string>;
  term: string;
}): void => {
  const clean = term.trim();
  if (clean) {
    all.add(clean);
  }
};

type MediaReferenceMetadata = {
  terms: string[];
  mediaTypeHint?: MediaTypeHint;
  displayName?: string;
};

const getMediaReferenceData = (
  blockString: string,
): {
  metadataByUrl: Map<string, MediaReferenceMetadata>;
  matches: { url: string; index: number }[];
  plainText: string;
} => {
  const matches: { url: string; index: number }[] = [];
  const plainText = blockString.split("");
  const byUrl = new Map<
    string,
    { terms: Set<string>; mediaTypeHint?: MediaTypeHint; displayName?: string }
  >();
  const add = ({
    url,
    term,
    mediaTypeHint,
    displayName,
  }: {
    url: string;
    term: string;
    mediaTypeHint?: MediaTypeHint;
    displayName?: string;
  }): void => {
    const key = stripTrailingChars(url.trim());
    if (!key) {
      return;
    }
    if (!byUrl.has(key)) {
      byUrl.set(key, { terms: new Set<string>(), mediaTypeHint, displayName });
    }
    const metadata = byUrl.get(key) as {
      terms: Set<string>;
      mediaTypeHint?: MediaTypeHint;
      displayName?: string;
    };
    addSearchTerm({ all: metadata.terms, term });
    metadata.mediaTypeHint ||= mediaTypeHint;
    metadata.displayName ||= displayName;
  };

  MARKDOWN_MEDIA_REGEX.lastIndex = 0;
  for (
    let match = MARKDOWN_MEDIA_REGEX.exec(blockString);
    match;
    match = MARKDOWN_MEDIA_REGEX.exec(blockString)
  ) {
    const [, imageMarker, label, url] = match;
    matches.push({ url, index: match.index });
    plainText.fill(" ", match.index, match.index + match[0].length);
    add({
      url,
      term: label || "",
      mediaTypeHint: imageMarker ? "image" : undefined,
      displayName: label || undefined,
    });
  }

  ROAM_MEDIA_MACRO_REGEX.lastIndex = 0;
  for (
    let match = ROAM_MEDIA_MACRO_REGEX.exec(blockString);
    match;
    match = ROAM_MEDIA_MACRO_REGEX.exec(blockString)
  ) {
    const [, macroType, url] = match;
    matches.push({ url, index: match.index });
    plainText.fill(" ", match.index, match.index + match[0].length);
    add({
      url,
      term: macroType || "",
      mediaTypeHint: macroType as MediaTypeHint,
    });
  }

  return {
    metadataByUrl: new Map(
      Array.from(byUrl.entries()).map(([url, metadata]) => [
        url,
        {
          terms: Array.from(metadata.terms),
          mediaTypeHint: metadata.mediaTypeHint,
          displayName: metadata.displayName,
        },
      ]),
    ),
    matches,
    plainText: plainText.join(""),
  };
};

export const extractMediaReferences = (
  blockString: string,
): ParsedMediaReference[] => {
  const {
    metadataByUrl,
    matches: recognized,
    plainText,
  } = getMediaReferenceData(blockString);
  URL_REGEX.lastIndex = 0;
  const matches = [
    ...recognized,
    ...Array.from(plainText.matchAll(URL_REGEX), (match) => ({
      url: match[0],
      index: match.index ?? 0,
    })),
  ]
    .sort((a, b) => a.index - b.index)
    .map(({ url }) => url);
  const byUrl = matches.reduce<
    Map<
      string,
      {
        parsed: ParsedMediaUrl;
        terms: Set<string>;
        displayName: string;
      }
    >
  >((all, raw) => {
    try {
      const metadata = metadataByUrl.get(stripTrailingChars(raw.trim()));
      const parsed = parseMediaUrl(raw, metadata?.mediaTypeHint);
      if (parsed) {
        if (!all.has(parsed.url)) {
          const terms = new Set<string>();
          addSearchTerm({ all: terms, term: parsed.fileName });
          metadata?.terms.forEach((term) => {
            addSearchTerm({ all: terms, term });
          });
          all.set(parsed.url, {
            parsed,
            terms,
            displayName: metadata?.displayName || "",
          });
        } else {
          const existing = all.get(parsed.url) as {
            parsed: ParsedMediaUrl;
            terms: Set<string>;
            displayName: string;
          };
          metadata?.terms.forEach((term) => {
            addSearchTerm({ all: existing.terms, term });
          });
          existing.displayName ||= metadata?.displayName || "";
        }
      }
    } catch (_e) {
      // Keep scanning if one URL is malformed.
    }
    return all;
  }, new Map());

  return Array.from(byUrl.values()).map(({ parsed, terms, displayName }) => ({
    ...parsed,
    searchText: Array.from(terms).join(" "),
    displayName,
  }));
};

export const extractMediaUrls = (blockString: string): ParsedMediaUrl[] => {
  return extractMediaReferences(blockString).map(
    ({ searchText, displayName, ...parsed }) => {
      void searchText;
      void displayName;
      return parsed;
    },
  );
};

export const inferOrientation = ({
  width,
  height,
}: {
  width: number | null;
  height: number | null;
}): Orientation => {
  if (!width || !height) {
    return "unknown";
  }
  if (width === height) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
};

export const getSafeMediaUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};
