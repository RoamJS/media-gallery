import { expect, test } from "@playwright/test";
import {
  getDecryptedMediaBlob,
  getOriginalMediaSource,
  resolveMediaPreviewSource,
} from "../src/utils/media/source";

const url =
  "https://firebasestorage.googleapis.com/v0/b/test/o/secret.png?alt=media";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
test.afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

test("encrypted previews use Roam-decrypted bytes and release their object URL", async () => {
  const file = new File(["decrypted pixels"], "Photo.png", {
    type: "image/png",
  });
  const reads: string[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        graph: { isEncrypted: true },
        file: {
          get: async ({ url }: { url: string }): Promise<File> => {
            reads.push(url);
            return file;
          },
        },
      },
    },
  });
  URL.createObjectURL = (blob): string => {
    blobs.push(blob as Blob);
    return "blob:decrypted";
  };
  URL.revokeObjectURL = (value): void => {
    revoked.push(value);
  };
  const source = await resolveMediaPreviewSource(url);
  expect(reads).toEqual([url]);
  expect(blobs).toEqual([file]);
  expect(await blobs[0].text()).toBe("decrypted pixels");
  expect(source.url).toBe("blob:decrypted");
  source.release();
  expect(revoked).toEqual(["blob:decrypted"]);
});

test("ordinary media preserves direct loading and never invokes decryption", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { graph: { isEncrypted: false } } },
  });
  expect(await getDecryptedMediaBlob(url)).toBeNull();
  const source = await resolveMediaPreviewSource(url);
  expect(source.url).toBe(url);
  source.release();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { graph: { isEncrypted: true } } },
  });
  expect(
    await getDecryptedMediaBlob("https://example.com/photo.png"),
  ).toBeNull();
  await expect(resolveMediaPreviewSource(url)).rejects.toThrow(
    "Roam file retrieval is unavailable",
  );
});

test("cancellation settles while Roam retrieval is pending", async () => {
  let finish: ((file: File) => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      roamAlphaAPI: {
        graph: { isEncrypted: true },
        file: {
          get: (): Promise<File> =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        },
      },
    },
  });
  const controller = new AbortController();
  const pending = getDecryptedMediaBlob(url, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  finish?.(new File(["late plaintext"], "image.png"));
});

test("encrypted originals never expose a document-opening URL, including active HTML and SVG", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { graph: { isEncrypted: true } } },
  });
  for (const extension of ["html", "svg", "xhtml", "pdf", "png"]) {
    expect(
      getOriginalMediaSource(url.replace("secret.png", `secret.${extension}`)),
    ).toBeNull();
  }
  expect(
    getOriginalMediaSource("blob:https://roamresearch.com/decrypted-document"),
  ).toBeNull();
});

test("ordinary originals keep their web origin and reject executable or blob URLs", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { roamAlphaAPI: { graph: { isEncrypted: false } } },
  });
  expect(getOriginalMediaSource(url)).toBe(url);
  expect(getOriginalMediaSource("https://example.com/file.svg")).toBe(
    "https://example.com/file.svg",
  );
  for (const unsafe of [
    "blob:https://roamresearch.com/file",
    "javascript:alert(1)",
    "data:text/html,script",
  ])
    expect(getOriginalMediaSource(unsafe)).toBeNull();
});

test("active encrypted content is rejected before creating any preview blob URL", async () => {
  let creations = 0;
  URL.createObjectURL = (): string => {
    creations++;
    return "blob:unsafe";
  };
  for (const mimeType of [
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/octet-stream",
    "",
  ]) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        roamAlphaAPI: {
          graph: { isEncrypted: true },
          file: {
            get: async (): Promise<File> =>
              new File(["active document"], "file", { type: mimeType }),
          },
        },
      },
    });
    await expect(resolveMediaPreviewSource(url)).rejects.toThrow(
      "must be downloaded",
    );
  }
  expect(creations).toBe(0);
});
