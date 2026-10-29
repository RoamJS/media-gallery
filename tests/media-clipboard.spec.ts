import { expect, test } from "@playwright/test";

import {
  copyMediaFileWithFallback,
  downloadMediaFile,
} from "../src/utils/media/clipboard";

type ClipboardData = Record<string, Blob | Promise<Blob>>;
type Download = { file: Blob; fileName: string };

const replacedProperties: {
  target: object;
  name: PropertyKey;
  descriptor: PropertyDescriptor | undefined;
}[] = [];

const replaceProperty = ({
  target = globalThis,
  name,
  value,
}: {
  target?: object;
  name: PropertyKey;
  value: unknown;
}): void => {
  replacedProperties.push({
    target,
    name,
    descriptor: Object.getOwnPropertyDescriptor(target, name),
  });
  Object.defineProperty(target, name, { configurable: true, value });
};

const installBrowser = ({
  clipboardAvailable = true,
  pngSupported = true,
  rejectWrite = false,
  rejectConversion = false,
}: {
  clipboardAvailable?: boolean;
  pngSupported?: boolean;
  rejectWrite?: boolean;
  rejectConversion?: boolean;
} = {}): {
  downloads: Download[];
  copied: Blob[];
  events: string[];
  revokeCallbacks: (() => void)[];
  revokedUrls: string[];
} => {
  const downloads: Download[] = [];
  const copied: Blob[] = [];
  const events: string[] = [];
  const revokeCallbacks: (() => void)[] = [];
  const revokedUrls: string[] = [];
  const objectUrls = new Map<string, Blob>();

  class MockClipboardItem {
    readonly data: ClipboardData;

    constructor(data: ClipboardData) {
      this.data = data;
    }

    static supports(): boolean {
      return pngSupported;
    }
  }

  replaceProperty({ name: "ClipboardItem", value: MockClipboardItem });
  replaceProperty({
    name: "navigator",
    value: {
      clipboard: clipboardAvailable
        ? {
            write: async (items: MockClipboardItem[]): Promise<void> => {
              events.push("write");
              if (rejectWrite) {
                throw new DOMException(
                  "Clipboard permission denied",
                  "NotAllowedError",
                );
              }
              copied.push(await items[0].data["image/png"]);
            },
          }
        : undefined,
    },
  });
  replaceProperty({
    target: URL,
    name: "createObjectURL",
    value: (file: Blob): string => {
      const url = `blob:download-${objectUrls.size}`;
      objectUrls.set(url, file);
      return url;
    },
  });
  replaceProperty({
    target: URL,
    name: "revokeObjectURL",
    value: (url: string): void => {
      revokedUrls.push(url);
    },
  });
  replaceProperty({
    name: "window",
    value: {
      setTimeout: (callback: () => void): number => {
        revokeCallbacks.push(callback);
        return revokeCallbacks.length;
      },
    },
  });
  replaceProperty({
    name: "createImageBitmap",
    value: async (): Promise<{
      width: number;
      height: number;
      close: () => void;
    }> => ({
      width: 12,
      height: 8,
      close: (): void => {
        events.push("bitmap-closed");
      },
    }),
  });
  replaceProperty({
    name: "document",
    value: {
      body: {
        appendChild: (): void => {
          events.push("anchor-attached");
        },
      },
      createElement: (tag: string): unknown => {
        if (tag === "canvas") {
          return {
            getContext: (): { drawImage: () => void } => ({
              drawImage: (): void => {
                events.push("image-converted");
              },
            }),
            toBlob: (callback: (blob: Blob | null) => void): void => {
              callback(
                rejectConversion
                  ? null
                  : new Blob(["converted PNG"], { type: "image/png" }),
              );
            },
          };
        }
        const anchor = {
          href: "",
          download: "",
          click: (): void => {
            const file = objectUrls.get(anchor.href);
            if (!file) throw new Error("Missing download file");
            downloads.push({ file, fileName: anchor.download });
          },
          remove: (): void => {
            events.push("anchor-removed");
          },
        };
        return anchor;
      },
    },
  });
  return { downloads, copied, events, revokeCallbacks, revokedUrls };
};

test.afterEach(() => {
  for (const { target, name, descriptor } of replacedProperties.reverse()) {
    if (descriptor) {
      Object.defineProperty(target, name, descriptor);
    } else {
      Reflect.deleteProperty(target, name);
    }
  }
  replacedProperties.length = 0;
});

test("starts clipboard write before the image fetch resolves", async () => {
  const browser = installBrowser();
  const file = new File(["original PNG"], "image.png", { type: "image/png" });
  let resolveFile: (file: File) => void = (): void => undefined;
  const filePromise = new Promise<File>((resolve) => {
    resolveFile = resolve;
  });
  const resultPromise = copyMediaFileWithFallback({
    loadFile: () => filePromise,
    fileName: file.name,
    mimeType: file.type,
  });

  expect(browser.events).toEqual(["write"]);
  resolveFile(file);
  expect(await resultPromise).toEqual({
    status: "copied",
    file,
    convertedToPng: false,
  });
  expect(browser.copied).toEqual([file]);
  expect(browser.downloads).toHaveLength(0);
});

test("copies JPEG as PNG while retaining original file metadata", async () => {
  const browser = installBrowser();
  const file = new File(["original JPEG"], "photo.jpg", { type: "image/jpeg" });
  const result = await copyMediaFileWithFallback({
    loadFile: async () => file,
    fileName: file.name,
    mimeType: file.type,
  });

  expect(result).toEqual({ status: "copied", file, convertedToPng: true });
  expect(browser.copied[0].type).toBe("image/png");
  expect(await browser.copied[0].text()).toBe("converted PNG");
  expect(browser.events).toContain("bitmap-closed");
  expect(browser.downloads).toHaveLength(0);
});

for (const mimeType of [
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
]) {
  test(`downloads ${mimeType} without converting or losing original bytes`, async () => {
    const browser = installBrowser();
    const file = new File(
      ["all original frames or file bytes"],
      "storage-name",
      {
        type: mimeType,
      },
    );
    const result = await copyMediaFileWithFallback({
      loadFile: async () => file,
      fileName: "Original user filename",
      mimeType,
    });

    expect(result).toEqual({
      status: "download-started",
      file,
      reason: "unsupported-format",
    });
    expect(browser.downloads).toEqual([
      { file, fileName: "Original user filename" },
    ]);
    expect(browser.copied).toHaveLength(0);
    expect(browser.events).not.toContain("image-converted");
  });
}

for (const options of [
  { clipboardAvailable: false },
  { pngSupported: false },
]) {
  test(`downloads when PNG clipboard is unavailable: ${JSON.stringify(options)}`, async () => {
    const browser = installBrowser(options);
    const file = new File(["PNG"], "image.png", { type: "image/png" });
    const result = await copyMediaFileWithFallback({
      loadFile: async () => file,
      fileName: file.name,
      mimeType: file.type,
    });

    expect(result.status).toBe("download-started");
    expect(result).toHaveProperty("reason", "clipboard-unavailable");
    expect(browser.downloads[0].file).toBe(file);
  });
}

test("downloads original file after clipboard permission is denied", async () => {
  const browser = installBrowser({ rejectWrite: true });
  const file = new File(["JPEG"], "original.jpg", { type: "image/jpeg" });
  const result = await copyMediaFileWithFallback({
    loadFile: async () => file,
    fileName: file.name,
    mimeType: file.type,
  });

  expect(result).toEqual({
    status: "download-started",
    file,
    reason: "clipboard-failed",
  });
  expect(browser.downloads).toEqual([{ file, fileName: file.name }]);
});

test("downloads original bytes if image conversion fails and closes bitmap", async () => {
  const browser = installBrowser({ rejectConversion: true });
  const file = new File(["JPEG"], "original.jpg", { type: "image/jpeg" });
  const result = await copyMediaFileWithFallback({
    loadFile: async () => file,
    fileName: file.name,
    mimeType: file.type,
  });

  expect(result.status).toBe("download-started");
  expect(browser.events).toContain("bitmap-closed");
  expect(browser.downloads[0].file).toBe(file);
});

test("does not flatten an animated file when its URL suggested PNG", async () => {
  const browser = installBrowser();
  const file = new File(["all GIF frames"], "image.gif", { type: "image/gif" });
  const result = await copyMediaFileWithFallback({
    loadFile: async () => file,
    fileName: file.name,
    mimeType: "image/png",
  });

  expect(result.status).toBe("download-started");
  expect(browser.events).not.toContain("image-converted");
  expect(browser.downloads[0].file).toBe(file);
});

test("reports unreadable remote files as errors without claiming copy or download", async () => {
  const browser = installBrowser({ rejectWrite: true });
  await expect(
    copyMediaFileWithFallback({
      loadFile: async () => {
        throw new Error("The file could not be fetched");
      },
      fileName: "remote.png",
      mimeType: "image/png",
    }),
  ).rejects.toThrow("The file could not be fetched");
  expect(browser.downloads).toHaveLength(0);
  expect(browser.copied).toHaveLength(0);
});

test("removes temporary link and releases download URL after download begins", () => {
  const browser = installBrowser();
  const file = new File(["PDF"], "original.pdf", { type: "application/pdf" });
  downloadMediaFile({ file });

  expect(browser.downloads).toEqual([{ file, fileName: "original.pdf" }]);
  expect(browser.events).toEqual(["anchor-attached", "anchor-removed"]);
  expect(browser.revokedUrls).toHaveLength(0);
  browser.revokeCallbacks[0]();
  expect(browser.revokedUrls).toEqual(["blob:download-0"]);
});
