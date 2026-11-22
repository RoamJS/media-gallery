import createBlock from "roamjs-components/writes/createBlock";
import createPage from "roamjs-components/writes/createPage";
import getCurrentPageUid from "roamjs-components/dom/getCurrentPageUid";

import type { MediaItem, MediaReference } from "~/types/media";
import {
  copyMediaFileWithFallback,
  type MediaCopyResult,
} from "~/utils/media/clipboard";
import {
  classifyMediaType,
  getExtension,
  extractMediaReferences,
  inferOrientation,
  isRoamStorageUrl,
  parseMediaUrl,
} from "~/utils/media/url";

type PullRecord = Record<string, unknown>;

type FileApi = {
  upload?: (args: {
    file: File;
    toast?: { hide?: boolean };
  }) => Promise<string>;
  get?: (args: { url: string }) => Promise<File>;
};

type RoamApiWithFile = typeof window.roamAlphaAPI & {
  file?: FileApi;
};

type BlockMeta = {
  uid: string;
  pageUid: string;
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
  {:block/page [:block/uid]}
  :create/time
  :edit/time
  {:create/user [:user/display-name :user/uid {:user/display-page [:node/title]}]}
  {:edit/user [:user/display-name :user/uid {:user/display-page [:node/title]}]}
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
  const displayPageName = getValue<string>({
    obj: getValue({
      obj: user,
      keys: [
        ":user/display-page",
        "user/display-page",
        "display-page",
        "displayPage",
      ],
    }),
    keys: [":node/title", "node/title", "title"],
  });
  return displayName || displayPageName || uid || "Unknown";
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
      const pageUid =
        getValue<string>({
          obj: getValue({
            obj: pull,
            keys: [":block/page", "block/page", "page"],
          }),
          keys: [":block/uid", "block/uid", "uid"],
        }) || "";
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
        pageUid,
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
  pageUid: meta?.pageUid || "",
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
          fileName: parsed.displayName || parsed.fileName,
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
      if (
        (existing.mediaType === "other" && parsed.mediaType !== "other") ||
        (existing.mediaType === "image" &&
          existing.mimeType === "application/octet-stream" &&
          (parsed.mediaType === "gif" || parsed.mediaType === "image") &&
          parsed.mimeType !== "application/octet-stream")
      ) {
        existing.extension = parsed.extension;
        existing.mediaType = parsed.mediaType;
        existing.mimeType = parsed.mimeType;
      }
      if (parsed.displayName && existing.fileName === parsed.fileName) {
        existing.fileName = parsed.displayName;
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

export const getPreferredMediaReference = ({
  item,
}: {
  item: MediaItem;
}): MediaReference | null =>
  item.references.reduce<MediaReference | null>((preferred, candidate) => {
    if (!preferred) {
      return candidate;
    }
    const preferredUpdatedTime = preferred.updatedTime ?? 0;
    const candidateUpdatedTime = candidate.updatedTime ?? 0;
    if (candidateUpdatedTime !== preferredUpdatedTime) {
      return candidateUpdatedTime > preferredUpdatedTime
        ? candidate
        : preferred;
    }
    return candidate.blockUid < preferred.blockUid ? candidate : preferred;
  }, null);

export const openMediaItemSource = async ({
  item,
}: {
  item: MediaItem;
}): Promise<void> => {
  const reference = getPreferredMediaReference({ item });
  if (!reference) {
    return;
  }
  await window.roamAlphaAPI.ui.mainWindow.openBlock({
    block: { uid: reference.blockUid },
  });
};

export const openMediaItemReferences = async ({
  item,
}: {
  item: MediaItem;
}): Promise<void> => {
  const blockUids = Array.from(
    new Set(item.references.map(({ blockUid }) => blockUid)),
  ).filter(Boolean);
  for (const blockUid of [...blockUids].reverse()) {
    await window.roamAlphaAPI.ui.rightSidebar.addWindow({
      window: { type: "block", "block-uid": blockUid },
    });
  }
};

export const captureUploadParentUid = (): string | null => {
  const focused = window.roamAlphaAPI.ui.getFocusedBlock();
  if (focused?.["block-uid"]) {
    return focused["block-uid"];
  }
  return getCurrentPageUid() || null;
};

export const uploadDestinationLabel = async (
  uid?: string | null,
): Promise<string> => {
  if (!uid) return MEDIA_UPLOADS_PAGE;
  try {
    const label: unknown = await window.roamAlphaAPI.data.async.q(
      "[:find ?label . :in $ ?uid :where [?p :block/uid ?uid] (or [?p :node/title ?label] [?p :block/string ?label])]",
      uid,
    );
    if (typeof label === "string") return label.trim() || "untitled block";
  } catch {
    /* A label lookup must not prevent uploads. */
  }
  return "selected location";
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

const getOrCreateUploadsParentUid = async ({
  parentUid,
}: {
  parentUid: string | null;
}): Promise<string> => {
  if (parentUid) {
    return parentUid;
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

const sanitizeMarkdownLabel = (value: string): string =>
  value
    .replace(/[\[\]\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Uploaded media";

export const formatUploadedMediaReference = ({
  url,
  fileName,
  mediaType,
}: {
  url: string;
  fileName: string;
  mediaType?: MediaItem["mediaType"];
}): string => {
  const parsed = parseMediaUrl(
    url,
    mediaType === "gif"
      ? "image"
      : mediaType === "image" || mediaType === "video" || mediaType === "audio"
        ? mediaType
        : undefined,
  );
  if (!parsed) {
    return url;
  }
  const label = sanitizeMarkdownLabel(fileName);
  const detectedType = mediaType || parsed.mediaType;
  if (detectedType === "image" || detectedType === "gif") {
    return `![${label}](${url})`;
  }
  if (detectedType === "video") {
    return `{{[[video]]: ${url}}} [${label}](${url})`;
  }
  if (detectedType === "audio") {
    return `{{[[audio]]: ${url}}} [${label}](${url})`;
  }
  return `[${label}](${url})`;
};

export const extractUploadedFileUrl = (uploadResult: string): string | null =>
  parseMediaUrl(uploadResult)?.url ||
  extractMediaReferences(uploadResult)[0]?.url ||
  null;

const waitForBlockToBeQueryable = async ({
  blockUid,
  timeoutMs = 5_000,
}: {
  blockUid: string;
  timeoutMs?: number;
}): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blockString = (await window.roamAlphaAPI.data.async.q(
      "[:find ?string . :in $ ?uid :where [?b :block/uid ?uid] [?b :block/string ?string]]",
      blockUid,
    )) as unknown;
    if (typeof blockString === "string") {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("Roam has not confirmed the reference yet.");
};

type UploadedReference = {
  url: string;
  fileName: string;
  text: string;
  blockUid: string;
  parentUid: string | null;
};

const writeUploadedReference = async (
  reference: UploadedReference,
  parentUid: string | null,
): Promise<string> => {
  const destination = await getOrCreateUploadsParentUid({ parentUid });
  await createBlock({
    parentUid: destination,
    order: "last",
    node: { uid: reference.blockUid, text: reference.text },
  });
  await waitForBlockToBeQueryable({ blockUid: reference.blockUid });
  return destination;
};

export class PendingUploadReference extends Error {
  destinationUid: string | null = null;
  constructor(readonly reference: UploadedReference) {
    super("File uploaded, but its reference could not be confirmed.");
  }

  async retry(): Promise<void> {
    const { blockUid, text, parentUid } = this.reference;
    const existing: unknown = await window.roamAlphaAPI.data.async.q(
      "[:find ?s . :in $ ?uid :where [?b :block/uid ?uid] [?b :block/string ?s]]",
      blockUid,
    );
    if (existing === text) {
      this.destinationUid = (await window.roamAlphaAPI.data.async.q(
        "[:find ?uid . :in $ ?child :where [?b :block/uid ?child] [?p :block/children ?b] [?p :block/uid ?uid]]",
        blockUid,
      )) as unknown as string | null;
      return;
    }
    if (typeof existing === "string")
      throw new Error(
        "This reference was edited. Copy the file URL to keep that edit.",
      );
    const parentExists =
      parentUid &&
      (await window.roamAlphaAPI.data.async.q(
        "[:find ?e . :in $ ?uid :where [?e :block/uid ?uid]]",
        parentUid,
      ));
    this.destinationUid = await writeUploadedReference(
      this.reference,
      parentExists ? parentUid : null,
    );
  }
}

export const uploadFileAndCreateReference = async ({
  file,
  fileName: requestedFileName,
  parentUid: requestedParentUid,
}: {
  file: File;
  fileName?: string;
  parentUid?: string | null;
}): Promise<string> => {
  const capturedParentUid =
    requestedParentUid === undefined
      ? captureUploadParentUid()
      : requestedParentUid;
  const fileApi = getFileApi();
  const fileName = requestedFileName || file.name || "Uploaded media";
  let uploadResult: string | null = null;
  if (typeof fileApi.upload === "function") {
    uploadResult = await fileApi.upload({ file, toast: { hide: true } });
  } else if (typeof window.roamAlphaAPI.util.uploadFile === "function") {
    uploadResult = await window.roamAlphaAPI.util.uploadFile({ file });
  }
  const url = uploadResult ? extractUploadedFileUrl(uploadResult) : null;
  if (!url) {
    throw new Error("Roam did not return a usable URL for the uploaded file.");
  }
  const mediaType = classifyMediaType({
    extension: getExtension(fileName),
    mimeType: file.type,
  });
  const reference: UploadedReference = {
    url,
    fileName,
    parentUid: capturedParentUid,
    blockUid: window.roamAlphaAPI.util.generateUID(),
    text: formatUploadedMediaReference({
      url,
      fileName,
      mediaType: mediaType === "other" ? undefined : mediaType,
    }),
  };
  try {
    await writeUploadedReference(reference, capturedParentUid);
  } catch {
    throw new PendingUploadReference(reference);
  }
  return url;
};

const fetchAsFile = async ({ url }: { url: string }): Promise<File> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch the media file (HTTP ${response.status}).`,
    );
  }
  const blob = await response.blob();
  const parsed = parseMediaUrl(url);
  const fileName = parsed?.fileName || "media-file";
  return new File([blob], fileName, {
    type: blob.type || parsed?.mimeType || "application/octet-stream",
  });
};

export const getFileByUrl = async ({ url }: { url: string }): Promise<File> => {
  if (!isRoamStorageUrl(url)) {
    return fetchAsFile({ url });
  }
  const fileApi = getFileApi();
  if (typeof fileApi.get !== "function") {
    throw new Error(
      "Roam file retrieval is unavailable. Please reload Roam and try again.",
    );
  }
  // Raw fetching could return encrypted bytes instead of the usable original file.
  return fileApi.get({ url });
};

export const copyTextToClipboard = async ({
  text,
}: {
  text: string;
}): Promise<void> => {
  await navigator.clipboard.writeText(text);
};

export const copyMediaFile = ({
  url,
  fileName,
  mimeType,
}: {
  url: string;
  fileName: string;
  mimeType: string;
}): Promise<MediaCopyResult> =>
  copyMediaFileWithFallback({
    loadFile: () => getFileByUrl({ url }),
    fileName,
    mimeType,
  });

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
