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
const MARKDOWN_MEDIA_REGEX = /!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const ROAM_MEDIA_MACRO_REGEX =
  /\{\{\[\[(video|audio)\]\]:\s*(https?:\/\/[^}\s]+)\s*\}\}/gi;

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

const shouldKeepUrl = (url: URL, extension: string): boolean => {
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
};

export const parseMediaUrl = (raw: string): ParsedMediaUrl | null => {
  const clean = stripTrailingChars(raw.trim());
  const parsed = toUrlOrNull(clean);
  if (!parsed) {
    return null;
  }
  const fullPath = decodeFirebaseObjectPath(parsed);
  const fileName = fullPath.split("/").pop() || parsed.hostname;
  const extension = getExtension(fileName);
  if (!shouldKeepUrl(parsed, extension)) {
    return null;
  }
  const mediaType = classifyMediaType({ extension, mimeType: "" });
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

const getMarkdownSearchTermsByUrl = (
  blockString: string,
): Map<string, string[]> => {
  const byUrl = new Map<string, Set<string>>();
  const add = ({ url, term }: { url: string; term: string }): void => {
    const key = stripTrailingChars(url.trim());
    if (!key) {
      return;
    }
    if (!byUrl.has(key)) {
      byUrl.set(key, new Set<string>());
    }
    addSearchTerm({ all: byUrl.get(key) as Set<string>, term });
  };

  MARKDOWN_MEDIA_REGEX.lastIndex = 0;
  for (
    let match = MARKDOWN_MEDIA_REGEX.exec(blockString);
    match;
    match = MARKDOWN_MEDIA_REGEX.exec(blockString)
  ) {
    const [, label, url] = match;
    add({ url, term: label || "" });
  }

  ROAM_MEDIA_MACRO_REGEX.lastIndex = 0;
  for (
    let match = ROAM_MEDIA_MACRO_REGEX.exec(blockString);
    match;
    match = ROAM_MEDIA_MACRO_REGEX.exec(blockString)
  ) {
    const [, macroType, url] = match;
    add({ url, term: macroType || "" });
  }

  return new Map(
    Array.from(byUrl.entries()).map(([url, terms]) => [url, Array.from(terms)]),
  );
};

export const extractMediaReferences = (
  blockString: string,
): ParsedMediaReference[] => {
  const matches = blockString.match(URL_REGEX) || [];
  const markdownTermsByUrl = getMarkdownSearchTermsByUrl(blockString);
  const byUrl = matches.reduce<
    Map<
      string,
      {
        parsed: ParsedMediaUrl;
        terms: Set<string>;
      }
    >
  >((all, raw) => {
    try {
      const parsed = parseMediaUrl(raw);
      if (parsed) {
        if (!all.has(parsed.url)) {
          const terms = new Set<string>();
          addSearchTerm({ all: terms, term: parsed.fileName });
          markdownTermsByUrl.get(parsed.url)?.forEach((term) => {
            addSearchTerm({ all: terms, term });
          });
          all.set(parsed.url, { parsed, terms });
        } else {
          const existing = all.get(parsed.url) as {
            parsed: ParsedMediaUrl;
            terms: Set<string>;
          };
          markdownTermsByUrl.get(parsed.url)?.forEach((term) => {
            addSearchTerm({ all: existing.terms, term });
          });
        }
      }
    } catch (_e) {
      // Keep scanning if one URL is malformed.
    }
    return all;
  }, new Map());

  return Array.from(byUrl.values()).map(({ parsed, terms }) => ({
    ...parsed,
    searchText: Array.from(terms).join(" "),
  }));
};

export const extractMediaUrls = (blockString: string): ParsedMediaUrl[] => {
  return extractMediaReferences(blockString).map(
    ({ searchText, ...parsed }) => {
      void searchText;
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
