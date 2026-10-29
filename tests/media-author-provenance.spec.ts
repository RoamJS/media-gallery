import { expect, test } from "@playwright/test";

import { queryAllMediaItems } from "~/utils/media/roam";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

test.afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("derives media authors from reference-block creators and editors, resolving Roam profile names", async () => {
  const url = "https://example.com/photo.png";
  const metadata = [
    {
      ":block/uid": "first-ref",
      ":create/user": {
        ":user/uid": "alice-uid",
        ":user/display-page": { ":node/title": "Alice" },
      },
      ":edit/user": {
        ":user/uid": "bob-uid",
        ":user/display-name": "Bob",
      },
    },
    {
      ":block/uid": "second-ref",
      ":create/user": {
        ":user/uid": "carol-uid",
        ":user/display-page": { ":node/title": "Carol" },
      },
      ":edit/user": { ":user/uid": "user-with-no-name" },
    },
  ];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      roamAlphaAPI: {
        data: {
          backend: {
            q: async (): Promise<string[][]> => [
              ["first-ref", `![Photo](${url})`],
              ["second-ref", `![Another reference](${url})`],
            ],
          },
          async: {
            pull_many: async (): Promise<typeof metadata> => metadata,
          },
        },
      },
    },
  });

  const items = await queryAllMediaItems();
  expect(items).toHaveLength(1);
  expect(items[0].authors).toEqual([
    "Alice",
    "Bob",
    "Carol",
    "user-with-no-name",
  ]);
  expect(items[0].references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        blockUid: "first-ref",
        createdAuthor: "Alice",
        updatedAuthor: "Bob",
      }),
      expect.objectContaining({
        blockUid: "second-ref",
        createdAuthor: "Carol",
        updatedAuthor: "user-with-no-name",
      }),
    ]),
  );
});
