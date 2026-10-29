import { expect, test } from "@playwright/test";

import {
  captureUploadParentUid,
  formatUploadedMediaReference,
  getFileByUrl,
  uploadFileAndCreateReference,
} from "~/utils/media/roam";
import { extractMediaReferences } from "~/utils/media/url";

const HOSTED_URL =
  "https://firebasestorage.googleapis.com/v0/b/graph/o/generated.png?alt=media";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;

const setRoamFileGetter = (
  get?: (args: { url: string }) => Promise<File>,
): void => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { roamAlphaAPI: { file: { get } } },
  });
};

type UploadContext = {
  focusedUid: string | null;
  currentPageUid: string | null;
  uploadsPageUid: string | null;
  focusReads: number;
  createdBlocks: { parentUid: string; text: string }[];
  createdPages: { title: string; uid: string }[];
};

const setRoamUploadContext = ({
  focusedUid = "original-block",
  currentPageUid = "original-page",
  uploadsPageUid = "uploads-page",
  upload = async (): Promise<string> => HOSTED_URL,
}: {
  focusedUid?: string | null;
  currentPageUid?: string | null;
  uploadsPageUid?: string | null;
  upload?: () => Promise<string>;
} = {}): UploadContext => {
  const context: UploadContext = {
    focusedUid,
    currentPageUid,
    uploadsPageUid,
    focusReads: 0,
    createdBlocks: [],
    createdPages: [],
  };
  let uidCount = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      location: {
        get hash(): string {
          return context.currentPageUid
            ? `#/app/test/page/${context.currentPageUid}`
            : "";
        },
      },
      roamAlphaAPI: {
        file: { upload },
        ui: {
          getFocusedBlock: (): { "block-uid": string } | null => {
            context.focusReads += 1;
            return context.focusedUid
              ? { "block-uid": context.focusedUid }
              : null;
          },
        },
        util: {
          dateToPageUid: (): string => "",
          generateUID: (): string => `created-${++uidCount}`,
        },
        data: {
          async: {
            q: async (query: string): Promise<string | null> =>
              query.includes(":node/title")
                ? context.uploadsPageUid
                : "Uploaded reference",
          },
        },
        createBlock: async ({
          location,
          block,
        }: {
          location: { "parent-uid": string };
          block: { string: string };
        }): Promise<void> => {
          context.createdBlocks.push({
            parentUid: location["parent-uid"],
            text: block.string,
          });
        },
        createPage: async ({
          page,
        }: {
          page: { title: string; uid: string };
        }): Promise<void> => {
          context.createdPages.push(page);
        },
      },
    },
  });
  return context;
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("retrieves hosted files through Roam and retains decrypted bytes and original metadata", async () => {
  const file = new File(["decrypted image"], "Original photo.jpg", {
    type: "image/jpeg",
  });
  const retrievedUrls: string[] = [];
  setRoamFileGetter(async ({ url }) => {
    retrievedUrls.push(url);
    return file;
  });
  globalThis.fetch = async (): Promise<Response> => {
    throw new Error("Hosted files must not be fetched directly");
  };

  expect(await getFileByUrl({ url: HOSTED_URL })).toBe(file);
  expect(retrievedUrls).toEqual([HOSTED_URL]);
});

test("does not fetch potentially encrypted raw bytes after a Roam retrieval failure", async () => {
  let fetchCount = 0;
  setRoamFileGetter(async () => {
    throw new Error("Decryption failed");
  });
  globalThis.fetch = async (): Promise<Response> => {
    fetchCount += 1;
    return new Response("ciphertext");
  };

  await expect(getFileByUrl({ url: HOSTED_URL })).rejects.toThrow(
    "Decryption failed",
  );
  expect(fetchCount).toBe(0);
});

test("fails clearly if the Roam file API is unavailable without downloading ciphertext", async () => {
  let fetchCount = 0;
  setRoamFileGetter();
  globalThis.fetch = async (): Promise<Response> => {
    fetchCount += 1;
    return new Response("ciphertext");
  };

  await expect(getFileByUrl({ url: HOSTED_URL })).rejects.toThrow(
    "Roam file retrieval is unavailable",
  );
  expect(fetchCount).toBe(0);
});

test("fetches external files without calling Roam and retains response bytes, MIME, and URL filename", async () => {
  const url = "https://example.com/files/Quarterly%20chart.jpg";
  let fetchedUrl: unknown;
  setRoamFileGetter(async () => {
    throw new Error("External files must not go through Roam storage");
  });
  globalThis.fetch = async (input): Promise<Response> => {
    fetchedUrl = input;
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "Content-Type": "image/jpeg" },
    });
  };

  const file = await getFileByUrl({ url });
  expect(fetchedUrl).toBe(url);
  expect(file.name).toBe("Quarterly chart.jpg");
  expect(file.type).toBe("image/jpeg");
  expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([
    1, 2, 3, 4,
  ]);
});

test("infers external MIME from filename when the response has no content type", async () => {
  globalThis.fetch = async (): Promise<Response> =>
    new Response(new Uint8Array([1, 2, 3]));

  const file = await getFileByUrl({ url: "https://example.com/chart.png" });
  expect(file.name).toBe("chart.png");
  expect(file.type).toBe("image/png");
});

test("rejects external HTTP errors without returning an error page as a media file", async () => {
  globalThis.fetch = async (): Promise<Response> =>
    new Response("Not found", { status: 404 });

  await expect(
    getFileByUrl({ url: "https://example.com/missing.png" }),
  ).rejects.toThrow("HTTP 404");
});

test("propagates external network or CORS failures", async () => {
  globalThis.fetch = async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  };

  await expect(
    getFileByUrl({ url: "https://example.com/blocked.png" }),
  ).rejects.toThrow("Failed to fetch");
});

test("captures the focused block before the gallery takes focus", async () => {
  const context = setRoamUploadContext();
  const parentUid = captureUploadParentUid();
  context.focusedUid = null;
  context.currentPageUid = "different-page";

  await uploadFileAndCreateReference({
    file: new File(["image"], "Photo.png", { type: "image/png" }),
    parentUid,
  });

  expect(parentUid).toBe("original-block");
  expect(context.focusReads).toBe(1);
  expect(context.createdBlocks).toEqual([
    { parentUid: "original-block", text: `![Photo.png](${HOSTED_URL})` },
  ]);
});

test("uses the page captured before opening when no block was focused", async () => {
  const context = setRoamUploadContext({ focusedUid: null });
  const parentUid = captureUploadParentUid();
  context.focusedUid = "newly-focused-block";

  await uploadFileAndCreateReference({
    file: new File(["image"], "Photo.png"),
    parentUid,
  });

  expect(parentUid).toBe("original-page");
  expect(context.createdBlocks[0].parentUid).toBe("original-page");
  expect(context.focusReads).toBe(1);
});

test("captures legacy callers' destination before waiting for upload", async () => {
  const context = setRoamUploadContext({
    upload: async (): Promise<string> => {
      await Promise.resolve();
      context.focusedUid = "different-block";
      context.currentPageUid = "different-page";
      return HOSTED_URL;
    },
  });

  await uploadFileAndCreateReference({
    file: new File(["image"], "Photo.png"),
  });

  expect(context.createdBlocks[0].parentUid).toBe("original-block");
  expect(context.focusReads).toBe(1);
});

test("an explicit null destination uses the existing uploads page without recapturing focus", async () => {
  const context = setRoamUploadContext();

  await uploadFileAndCreateReference({
    file: new File(["image"], "Photo.png"),
    parentUid: null,
  });

  expect(context.createdBlocks[0].parentUid).toBe("uploads-page");
  expect(context.createdPages).toEqual([]);
  expect(context.focusReads).toBe(0);
});

test("creates the uploads page when the captured destination and fallback page are absent", async () => {
  const context = setRoamUploadContext({
    focusedUid: null,
    currentPageUid: null,
    uploadsPageUid: null,
  });
  const parentUid = captureUploadParentUid();
  context.focusedUid = "later-focus";

  await uploadFileAndCreateReference({
    file: new File(["image"], "Photo.png"),
    parentUid,
  });

  expect(parentUid).toBeNull();
  expect(context.createdPages).toEqual([
    { title: "Media Gallery Uploads", uid: "created-1" },
  ]);
  expect(context.createdBlocks[0].parentUid).toBe("created-1");
  expect(context.focusReads).toBe(1);
});

for (const { fileName, extension, mediaType } of [
  { fileName: "MG Project brief.pdf", extension: "pdf", mediaType: "pdf" },
  {
    fileName: "MG Meeting notes.docx",
    extension: "docx",
    mediaType: "document",
  },
  { fileName: "MG Export.bin", extension: "bin", mediaType: "other" },
]) {
  test(`keeps the uploaded ${mediaType} filename searchable when storage assigns an opaque name`, async () => {
    const url = HOSTED_URL.replace(
      "generated.png",
      `opaque-storage-id.${extension}`,
    );
    const context = setRoamUploadContext({
      upload: async (): Promise<string> => url,
    });

    await uploadFileAndCreateReference({
      file: new File(["file bytes"], fileName),
      parentUid: "upload-destination",
    });

    const reference = context.createdBlocks[0];
    expect(reference).toEqual({
      parentUid: "upload-destination",
      text: `[${fileName}](${url})`,
    });
    const parsed = extractMediaReferences(reference.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ url, displayName: fileName, mediaType });
    expect(parsed[0].searchText).toContain(fileName);
  });
}

test("keeps document filename labels parseable when filenames contain Markdown brackets or newlines", () => {
  const url = HOSTED_URL.replace("generated.png", "opaque-storage-id.pdf");
  const reference = formatUploadedMediaReference({
    url,
    fileName: "[MG]\nProject brief.pdf",
  });

  expect(reference).toBe(`[MG Project brief.pdf](${url})`);
  expect(extractMediaReferences(reference)[0]).toMatchObject({
    url,
    displayName: "MG Project brief.pdf",
    mediaType: "pdf",
  });
});

for (const mediaType of ["image", "gif", "video", "audio"] as const) {
  test(`Copy Markdown preserves explicit ${mediaType} type for extensionless URLs`, () => {
    const url = "https://example.com/media?id=123";
    const formatted = formatUploadedMediaReference({
      url,
      fileName: "Whiteboard",
      mediaType,
    });
    expect(formatted).toBe(
      mediaType === "image" || mediaType === "gif"
        ? `![Whiteboard](${url})`
        : `{{[[${mediaType}]]: ${url}}} [Whiteboard](${url})`,
    );
    expect(extractMediaReferences(formatted)[0]).toMatchObject({
      url,
      mediaType: mediaType === "gif" ? "image" : mediaType,
    });
  });
}

for (const { name, mime, mediaType } of [
  { name: "Photo.png", mime: "image/png", mediaType: "image" },
  { name: "Photo", mime: "image/jpeg", mediaType: "image" },
  { name: "Animation.gif", mime: "image/gif", mediaType: "image" },
  { name: "Clip.mp4", mime: "video/mp4", mediaType: "video" },
  { name: "Recording.mp3", mime: "audio/mpeg", mediaType: "audio" },
  { name: "Photo.png", mime: "", mediaType: "image" },
  { name: "Clip.mp4", mime: "", mediaType: "video" },
  { name: "Recording.wav", mime: "", mediaType: "audio" },
]) {
  test(`preserves ${name} media markup for opaque upload URLs with MIME ${mime || "unavailable"}`, async () => {
    const url =
      "https://firebasestorage.googleapis.com/v0/b/graph/o/opaque-id?alt=media";
    const context = setRoamUploadContext({
      upload: async (): Promise<string> => url,
    });
    await uploadFileAndCreateReference({
      file: new File(["file bytes"], name, { type: mime }),
      parentUid: "upload-destination",
    });
    const text = context.createdBlocks[0].text;
    expect(text).toBe(
      mediaType === "image"
        ? `![${name}](${url})`
        : `{{[[${mediaType}]]: ${url}}} [${name}](${url})`,
    );
    expect(extractMediaReferences(text)[0]).toMatchObject({
      url,
      displayName: name,
      mediaType,
    });
  });
}
