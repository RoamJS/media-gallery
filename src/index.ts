import runExtension from "roamjs-components/util/runExtension";
import { render as renderToast } from "roamjs-components/components/Toast";
import createOverlayRender from "roamjs-components/util/createOverlayRender";

import MediaGalleryOverlay from "~/components/MediaGalleryOverlay";

const OPEN_MEDIA_GALLERY_COMMAND = "Open Media Gallery";

export default runExtension(async ({ extensionAPI }) => {
  const renderMediaGallery = createOverlayRender(
    "roamjs-media-gallery-overlay",
    MediaGalleryOverlay,
  );
  let closeOverlay: (() => void) | undefined;

  if (process.env.NODE_ENV === "development") {
    renderToast({
      id: "extension-base-loaded",
      content: "Successfully loaded Media Gallery",
      intent: "success",
      timeout: 500,
    });
  }

  await extensionAPI.ui.commandPalette.addCommand({
    label: OPEN_MEDIA_GALLERY_COMMAND,
    callback: () => {
      closeOverlay?.();
      closeOverlay = renderMediaGallery({});
    },
  });

  return {
    commands: [OPEN_MEDIA_GALLERY_COMMAND],
    unload: () => {
      closeOverlay?.();
    },
  };
});
