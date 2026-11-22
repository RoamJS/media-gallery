import assert from "node:assert/strict";

// Run with roamjs-load-extension's --test-module in an authenticated test graph.
export default {
  async run({ page }) {
    const gallery = page.locator(".roamjs-media-gallery-dialog");
    const palette = page.getByPlaceholder("Search Commands");
    const openPalette = async (command) => {
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+p" : "Control+p",
      );
      await palette.fill(command);
      const result = page.getByText(command, { exact: true });
      await result.waitFor();
      return result;
    };

    await page.keyboard.press("Escape");
    for (const [command, field] of [
      ["Open Media Gallery", "Search media"],
      ["Media Gallery: Semantic Image Search", "Describe an image"],
    ]) {
      await openPalette(command);
      await page
        .locator(".rm-menu-item--active")
        .getByText(command, { exact: true })
        .waitFor();
      await page.keyboard.press("Enter", { delay: 100 });
      const search = gallery.getByRole("textbox", { name: field });
      await search.waitFor();
      await page.waitForFunction(
        (label) => document.activeElement?.getAttribute("aria-label") === label,
        field,
      );
      await page.keyboard.type("cat");
      assert.equal(await search.inputValue(), "cat");
      await page.keyboard.press("Escape");
      await gallery.waitFor({ state: "hidden" });
    }

    const result = await openPalette("Open Media Gallery");
    await result.click();
    const close = gallery.getByRole("button", { name: "Close", exact: true });
    await close.focus();
    await close.press("Enter");
    await gallery.waitFor({ state: "hidden" });
  },
};
