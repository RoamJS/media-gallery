import createBlock from "roamjs-components/writes/createBlock";
import createPage from "roamjs-components/writes/createPage";
import getCurrentPageUid from "roamjs-components/dom/getCurrentPageUid";

import type { MediaItem, MediaReference } from "~/types/media";
import {
  extractMediaReferences,
  inferOrientation,
  parseMediaUrl,
} from "~/utils/media/url";

type PullRecord = Record<string, unknown>;

type FileApi = {
  upload?: (args: {
    file: File;
    toast?: { hide?: boolean };
  }) => Promise<string>;
  get?: (args: { url: string }) => Promise<File>;
  delete?: (args: { url: string }) => Promise<void>;
};

type RoamApiWithFile = typeof window.roamAlphaAPI & {
  file?: FileApi;
};

type BlockMeta = {
  uid: string;
  createdTime: number | null;
  updatedTime: number | null;
  createdAuthor: string;
  updatedAuthor: string;
};

const MEDIA_UPLOADS_PAGE = "Media Gallery Uploads";

const BLOCK_QUERY = `[:find ?uid ?string
:where
[?b :block/uid ?uid]
[?b :block/string ?string]]`;

const BLOCK_PULL_PATTERN = `[
  :block/uid
  :create/time
  :edit/time
  {:create/user [:user/display-name :user/uid]}
  {:edit/user [:user/display-name :user/uid]}
]`;

const toRecord = (value: unknown): PullRecord => {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as PullRecord;
};

const getValue = <T>({
  obj,
  keys,
}: {
  obj: unknown;
  keys: string[];
}): T | undefined => {
  const record = toRecord(obj);
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return undefined;
};

const toTimestamp = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : value instanceof Date
          ? value.valueOf()
          : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 1e11) {
    return Math.floor(numeric * 1000);
  }
  return Math.floor(numeric);
};

const readUserName = (value: unknown): string => {
  const user = toRecord(value);
  const displayName =
    (user[":user/display-name"] as string | undefined) ||
    (user["user/display-name"] as string | undefined) ||
    (user["display-name"] as string | undefined) ||
    (user.displayName as string | undefined);
  const uid =
    (user[":user/uid"] as string | undefined) ||
    (user["user/uid"] as string | undefined) ||
    (user.uid as string | undefined);
  return displayName || uid || "Unknown";
};

const getRoamApi = (): RoamApiWithFile =>
  window.roamAlphaAPI as RoamApiWithFile;

const toBlockRows = (
  rows: unknown[][],
): Array<{ uid: string; blockString: string }> =>
  rows
    .map((row) => {
      const [uid, blockString] = row;
      if (typeof uid !== "string" || typeof blockString !== "string") {
        return null;
      }
      return { uid, blockString };
    })
    .filter((row): row is { uid: string; blockString: string } => Boolean(row));

const queryBlockStrings = async (): Promise<
  Array<{ uid: string; blockString: string }>
> => {
  const roam = getRoamApi();
  try {
    const backendRows = await roam.data.backend.q(BLOCK_QUERY);
    return toBlockRows(backendRows as unknown[][]);
  } catch (_e) {
    const rows = await roam.data.async.q(BLOCK_QUERY);
    return toBlockRows(rows as unknown[][]);
  }
};

const chunk = <T>({ items, size }: { items: T[]; size: number }): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const pullBlockMetadata = async ({
  uids,
}: {
  uids: string[];
}): Promise<Map<string, BlockMeta>> => {
  const roam = getRoamApi();
  const chunks = chunk({ items: uids, size: 250 });
  const output = new Map<string, BlockMeta>();
  for (const uidChunk of chunks) {
    const eids = uidChunk.map((uid) => [":block/uid", uid]);
    let pulls: unknown[] = [];
    if (typeof roam.data.async.pull_many === "function") {
      pulls = (await roam.data.async.pull_many(
        BLOCK_PULL_PATTERN,
        eids,
      )) as unknown[];
    } else {
      pulls = roam.data.pull_many(
        BLOCK_PULL_PATTERN,
        eids as string[][],
      ) as unknown[];
    }
    pulls.forEach((pull) => {
      const uidValue = getValue<string>({
        obj: pull,
        keys: [":block/uid", "block/uid", "uid"],
      });
      if (!uidValue) {
        return;
      }
      const createdTime = toTimestamp(
        getValue({
          obj: pull,
          keys: [":create/time", "create/time", "createTime"],
        }),
      );
      const updatedTime = toTimestamp(
        getValue({
          obj: pull,
          keys: [":edit/time", "edit/time", "updatedTime"],
        }),
      );
      const createdAuthor = readUserName(
        getValue({
          obj: pull,
          keys: [":create/user", "create/user", "createUser"],
        }),
      );
      const updatedAuthor = readUserName(
        getValue({
          obj: pull,
          keys: [":edit/user", "edit/user", "editUser", "updatedUser"],
        }),
      );
      output.set(uidValue, {
        uid: uidValue,
        createdTime,
        updatedTime,
        createdAuthor,
        updatedAuthor,
      });
    });
  }
  return output;
};

const mergeAuthorLists = ({
  existing,
  candidate,
}: {
  existing: string[];
  candidate: string[];
}): string[] => {
  const output = new Set(existing);
  candidate.filter(Boolean).forEach((author) => output.add(author));
  return Array.from(output).sort((a, b) => a.localeCompare(b));
};

const mergeSearchText = ({
  existing,
  incoming,
}: {
  existing: string;
  incoming: string;
}): string => {
  const terms = new Set<string>();
  const addTerms = (value: string): void => {
    value
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((term) => terms.add(term));
  };
  addTerms(existing);
  addTerms(incoming);
  return Array.from(terms).join(" ");
};

const normalizeReference = ({
  blockUid,
  meta,
}: {
  blockUid: string;
  meta: BlockMeta | undefined;
}): MediaReference => ({
  blockUid,
  createdTime: meta?.createdTime ?? null,
  updatedTime: meta?.updatedTime ?? null,
  createdAuthor: meta?.createdAuthor || "Unknown",
  updatedAuthor: meta?.updatedAuthor || "Unknown",
});

const getCombinedCreatedTime = ({
  existing,
  incoming,
}: {
  existing: number | null;
  incoming: number | null;
}): number | null => {
  if (existing === null) {
    return incoming;
  }
  if (incoming === null) {
    return existing;
  }
  return Math.min(existing, incoming);
};

const getCombinedUpdatedTime = ({
  existing,
  incoming,
}: {
  existing: number | null;
  incoming: number | null;
}): number | null => {
  if (existing === null) {
    return incoming;
  }
  if (incoming === null) {
    return existing;
  }
  return Math.max(existing, incoming);
};

export const queryAllMediaItems = async (): Promise<MediaItem[]> => {
  const blockRows = await queryBlockStrings();
  const candidates = blockRows
    .map((row) => ({
      uid: row.uid,
      mediaReferences: extractMediaReferences(row.blockString),
    }))
    .filter((row) => row.mediaReferences.length > 0);

  const metaByUid = await pullBlockMetadata({
    uids: Array.from(new Set(candidates.map((c) => c.uid))),
  });

  const mediaByUrl = new Map<string, MediaItem>();
  candidates.forEach(({ uid, mediaReferences }) => {
    const blockMeta = metaByUid.get(uid);
    mediaReferences.forEach((parsed) => {
      const reference = normalizeReference({ blockUid: uid, meta: blockMeta });
      const existing = mediaByUrl.get(parsed.url);
      if (!existing) {
        const authors = mergeAuthorLists({
          existing: [],
          candidate: [reference.createdAuthor, reference.updatedAuthor],
        });
        mediaByUrl.set(parsed.url, {
          id: parsed.url,
          url: parsed.url,
          fileName: parsed.fileName,
          extension: parsed.extension,
          searchText: parsed.searchText,
          mediaType: parsed.mediaType,
          mimeType: parsed.mimeType,
          sizeBytes: null,
          width: null,
          height: null,
          orientation: "unknown",
          createdTime: reference.createdTime,
          updatedTime: reference.updatedTime,
          authors,
          references: [reference],
        });
        return;
      }
      existing.references.push(reference);
      existing.authors = mergeAuthorLists({
        existing: existing.authors,
        candidate: [reference.createdAuthor, reference.updatedAuthor],
      });
      existing.createdTime = getCombinedCreatedTime({
        existing: existing.createdTime,
        incoming: reference.createdTime,
      });
      existing.updatedTime = getCombinedUpdatedTime({
        existing: existing.updatedTime,
        incoming: reference.updatedTime,
      });
      existing.searchText = mergeSearchText({
        existing: existing.searchText,
        incoming: parsed.searchText,
      });
    });
  });

  return Array.from(mediaByUrl.values()).sort((a, b) => {
    const aTime = a.updatedTime ?? a.createdTime ?? 0;
    const bTime = b.updatedTime ?? b.createdTime ?? 0;
    return bTime - aTime;
  });
};

const getFocusedParentUid = (): string | null => {
  const focused = window.roamAlphaAPI.ui.getFocusedBlock();
  if (focused?.["block-uid"]) {
    return focused["block-uid"];
  }
  return null;
};

const getPageUidByTitle = async ({
  title,
}: {
  title: string;
}): Promise<string | null> => {
  const rows = (await window.roamAlphaAPI.data.async.q(
    "[:find ?uid . :in $ ?title :where [?p :node/title ?title] [?p :block/uid ?uid]]",
    title,
  )) as unknown as string | null;
  return typeof rows === "string" ? rows : null;
};

const getOrCreateUploadsParentUid = async (): Promise<string> => {
  const focusedUid = getFocusedParentUid();
  if (focusedUid) {
    return focusedUid;
  }
  const currentPageUid = getCurrentPageUid();
  if (currentPageUid) {
    return currentPageUid;
  }
  const existingUid = await getPageUidByTitle({ title: MEDIA_UPLOADS_PAGE });
  if (existingUid) {
    return existingUid;
  }
  return createPage({ title: MEDIA_UPLOADS_PAGE });
};

const getFileApi = (): FileApi => {
  const roam = getRoamApi();
  return roam.file || {};
};

const mediaMarkdownForUrl = ({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}): string => {
  const parsed = parseMediaUrl(url);
  if (!parsed) {
    return url;
  }
  if (parsed.mediaType === "image" || parsed.mediaType === "gif") {
    return `![${fileName}](${url})`;
  }
  if (parsed.mediaType === "video") {
    return `{{[[video]]: ${url}}}`;
  }
  if (parsed.mediaType === "audio") {
    return `{{[[audio]]: ${url}}}`;
  }
  return url;
};

export const uploadFileAndCreateReference = async ({
  file,
}: {
  file: File;
}): Promise<string> => {
  const fileApi = getFileApi();
  let url: string | null = null;
  if (typeof fileApi.upload === "function") {
    url = await fileApi.upload({ file, toast: { hide: true } });
  } else if (typeof window.roamAlphaAPI.util.uploadFile === "function") {
    url = await window.roamAlphaAPI.util.uploadFile({ file });
  }
  if (!url) {
    throw new Error("Roam file upload API is unavailable.");
  }
  const parentUid = await getOrCreateUploadsParentUid();
  await createBlock({
    parentUid,
    order: "last",
    node: {
      text: mediaMarkdownForUrl({ url, fileName: file.name }),
    },
  });
  return url;
};

export const deleteFileByUrl = async ({
  url,
}: {
  url: string;
}): Promise<void> => {
  const fileApi = getFileApi();
  if (typeof fileApi.delete !== "function") {
    throw new Error("Roam file delete API is unavailable.");
  }
  await fileApi.delete({ url });
};

const fetchAsFile = async ({ url }: { url: string }): Promise<File> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch file for clipboard.");
  }
  const blob = await response.blob();
  const parsed = parseMediaUrl(url);
  const fileName = parsed?.fileName || "media-file";
  return new File([blob], fileName, {
    type: blob.type || parsed?.mimeType || "application/octet-stream",
  });
};

export const getFileByUrl = async ({ url }: { url: string }): Promise<File> => {
  const fileApi = getFileApi();
  if (typeof fileApi.get === "function") {
    return fileApi.get({ url });
  }
  return fetchAsFile({ url });
};

export const copyTextToClipboard = async ({
  text,
}: {
  text: string;
}): Promise<void> => {
  await navigator.clipboard.writeText(text);
};

export const copyFileToClipboard = async ({
  file,
}: {
  file: File;
}): Promise<void> => {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function") {
    throw new Error("Clipboard file API is unavailable in this browser.");
  }
  if (typeof ClipboardItem === "undefined") {
    throw new Error("ClipboardItem is unavailable in this browser.");
  }
  const fileType = file.type || "application/octet-stream";
  await navigator.clipboard.write([
    new ClipboardItem({
      [fileType]: file,
    }),
  ]);
};

export const withImageDimensions = ({
  item,
  width,
  height,
}: {
  item: MediaItem;
  width: number;
  height: number;
}): MediaItem => ({
  ...item,
  width,
  height,
  orientation: inferOrientation({ width, height }),
});

export const withFileMetadata = ({
  item,
  file,
}: {
  item: MediaItem;
  file: File;
}): MediaItem => {
  const width = item.width;
  const height = item.height;
  return {
    ...item,
    mimeType: file.type || item.mimeType,
    sizeBytes: Number.isFinite(file.size) ? file.size : item.sizeBytes,
    width,
    height,
    orientation: inferOrientation({ width, height }),
  };
};
