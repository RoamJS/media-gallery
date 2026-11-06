import { expect, test } from "@playwright/test";
import {
  DEFAULT_FILTERS,
  getActiveConstraints,
  clearMediaConstraints,
  getDateRangeError,
  getReferenceEvents,
} from "~/utils/media/presentation";
import type { MediaItem, MediaReference } from "~/types/media";
import { runUploadBatch } from "~/utils/media/upload";
import type { MediaUpload } from "~/types/upload";
import {
  createUploadedMediaReference,
  resolveUploadDestination,
} from "~/utils/media/roam";

const makeUpload = (id: string): MediaUpload => ({
  id,
  blockUid: id,
  fileName: `${id}.png`,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  status: "queued",
});
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
test.afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("clearing constraints preserves search and date ordering", () => {
  const filters = {
    ...DEFAULT_FILTERS,
    query: "diagram",
    mediaType: "image" as const,
    author: "Alex",
    createdFrom: "2026-01-01",
    sortBy: "created" as const,
    sortDirection: "asc" as const,
  };
  expect(getActiveConstraints(filters).map((c) => c.key)).toEqual([
    "author",
    "mediaType",
    "createdFrom",
  ]);
  expect(clearMediaConstraints(filters)).toEqual({
    ...DEFAULT_FILTERS,
    query: "diagram",
    sortBy: "created",
    sortDirection: "asc",
  });
  expect(
    getActiveConstraints({
      ...DEFAULT_FILTERS,
      query: "diagram",
      sortDirection: "asc",
    }),
  ).toEqual([]);
});

test("explains reversed date ranges but permits a same-day range", () => {
  expect(
    getDateRangeError({
      ...DEFAULT_FILTERS,
      createdFrom: "2026-11-06",
      createdTo: "2026-11-05",
    }),
  ).toContain("creation end date");
  expect(
    getDateRangeError({
      ...DEFAULT_FILTERS,
      updatedFrom: "2026-11-06",
      updatedTo: "2026-11-05",
    }),
  ).toContain("edit end date");
  expect(
    getDateRangeError({
      ...DEFAULT_FILTERS,
      updatedFrom: "2026-11-06",
      updatedTo: "2026-11-06",
    }),
  ).toBe("");
});

test("ties creators and editors to their actual reference event and deduplicates block count", () => {
  const reference = (
    blockUid: string,
    createdTime: number | null,
    updatedTime: number | null,
    createdAuthor: string,
    updatedAuthor: string,
  ): MediaReference => ({
    blockUid,
    pageUid: "page",
    createdTime,
    updatedTime,
    createdAuthor,
    updatedAuthor,
  });
  const first = reference("first", 10, 15, "Zoe", "Ari"),
    latest = reference("latest", 20, 50, "Ben", "Jordan");
  const item = {
    references: [
      latest,
      first,
      latest,
      reference("unknown", null, null, "Unknown", "Unknown"),
    ],
  } as MediaItem;
  expect(getReferenceEvents(item)).toEqual({ first, latest, count: 3 });
  expect(
    getReferenceEvents({ references: [] } as unknown as MediaItem),
  ).toEqual({ first: null, latest: null, count: 0 });
});

test("a failed middle file preserves successes and continues to the next file", async () => {
  const uploaded: string[] = [],
    linked: string[] = [],
    snapshots: MediaUpload[][] = [];
  const result = await runUploadBatch({
    uploads: [makeUpload("one"), makeUpload("two"), makeUpload("three")],
    upload: async (item) => {
      uploaded.push(item.id);
      if (item.id === "two") throw new Error("Storage unavailable");
      return `https://example.com/${item.fileName}`;
    },
    link: async (item) => {
      linked.push(item.id);
    },
    onChange: (state) => snapshots.push(state),
  });
  expect(uploaded).toEqual(["one", "two", "three"]);
  expect(linked).toEqual(["one", "three"]);
  expect(result.map((item) => item.status)).toEqual([
    "added",
    "failed",
    "added",
  ]);
  expect(snapshots[0][0].status).toBe("uploading");
  expect(snapshots[0][0].url).toBeUndefined();
  expect(snapshots.at(-1)?.[2].status).toBe("added");
});

test("retry resumes linking with the uploaded URL and stable block UID", async () => {
  let uploadCount = 0,
    linkCount = 0;
  const uids: string[] = [];
  const upload = async (): Promise<string> => {
    uploadCount++;
    return "https://example.com/one.png";
  };
  const link = async (item: MediaUpload): Promise<void> => {
    linkCount++;
    uids.push(item.blockUid);
    if (linkCount === 1) throw new Error("Reference write failed");
  };
  const initial = await runUploadBatch({
    uploads: [makeUpload("stable")],
    upload,
    link,
    onChange: () => {},
  });
  expect(initial[0]).toMatchObject({
    status: "failed",
    url: "https://example.com/one.png",
  });
  const retried = await runUploadBatch({
    uploads: initial,
    upload,
    link,
    onChange: () => {},
  });
  expect(uploadCount).toBe(1);
  expect(uids).toEqual(["stable", "stable"]);
  expect(retried[0].status).toBe("added");
  await runUploadBatch({ uploads: retried, upload, link, onChange: () => {} });
  expect(linkCount).toBe(2);
});

test("retrying an uploaded reference with a lost acknowledgement does not create another block", async () => {
  const records = new Map<string, string>();
  let writes = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        data: {
          async: {
            q: async (_query: string, uid: string) => records.get(uid) ?? null,
          },
        },
        createBlock: async ({
          block,
        }: {
          block: { uid: string; string: string };
        }) => {
          writes++;
          records.set(block.uid, block.string);
          throw new Error("Acknowledgement lost");
        },
      },
    },
  });
  const args = {
    url: "https://example.com/photo.png",
    file: new File(["p"], "photo.png", { type: "image/png" }),
    fileName: "photo.png",
    parentUid: "parent",
    blockUid: "sameblock",
  };
  await expect(createUploadedMediaReference(args)).rejects.toThrow(
    "Acknowledgement lost",
  );
  await createUploadedMediaReference(args);
  expect(writes).toBe(1);
  records.set("sameblock", "Changed by user");
  await expect(createUploadedMediaReference(args)).rejects.toThrow(
    "reference changed",
  );
  expect(writes).toBe(1);
});

test("destination labels distinguish page, focused block and fallback without creating graph content", async () => {
  let record: unknown = { ":node/title": "Workshop notes" };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { data: { async: { pull: async () => record } } } },
  });
  expect(await resolveUploadDestination("page")).toEqual({
    parentUid: "page",
    label: "[[Workshop notes]]",
  });
  record = {
    ":block/string": "Important https://example.com/private-link notes",
    ":block/page": { ":node/title": "Workshop notes" },
  };
  expect((await resolveUploadDestination("block")).label).toBe(
    "[[Workshop notes]] › Important [link] notes",
  );
  expect(await resolveUploadDestination(null)).toEqual({
    parentUid: null,
    label: "[[Media Gallery Uploads]]",
  });
  record = null;
  await expect(resolveUploadDestination("deleted")).rejects.toThrow(
    "destination is unavailable",
  );
});
