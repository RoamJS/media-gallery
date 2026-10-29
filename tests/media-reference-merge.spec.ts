import { expect, test } from "@playwright/test";
import { queryAllMediaItems } from "../src/utils/media/roam";
import { selectSemanticCandidates } from "../src/utils/semantic/core";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
test.afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
for (const type of ["image", "video", "audio"] as const) {
  for (const plainFirst of [true, false]) {
    test(`merges explicit ${type} classification with plain reference ${plainFirst ? "first" : "last"}`, async () => {
      const url =
        "https://firebasestorage.googleapis.com/v0/b/test/o/opaque-id?alt=media";
      const embedded =
        type === "image"
          ? `![Photo](${url})`
          : `{{[[${type}]]: ${url}}} [Recording](${url})`;
      const rows = [
        ["plain-ref", url],
        ["embedded-ref", embedded],
      ];
      if (!plainFirst) rows.reverse();
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          roamAlphaAPI: {
            data: {
              backend: { q: async (): Promise<string[][]> => rows },
              async: {
                pull_many: async (): Promise<unknown[]> =>
                  rows.map(([uid]) => ({ ":block/uid": uid })),
              },
            },
          },
        },
      });
      const items = await queryAllMediaItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        mediaType: type,
        mimeType: "application/octet-stream",
        fileName: type === "image" ? "Photo" : "Recording",
      });
      expect(items[0].references).toHaveLength(2);
      expect(selectSemanticCandidates({ items })).toHaveLength(
        type === "image" ? 1 : 0,
      );
    });
  }
}
