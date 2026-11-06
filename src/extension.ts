import runExtension from "roamjs-components/util/runExtension";
import { render as renderToast } from "roamjs-components/components/Toast";
import createOverlayRender from "roamjs-components/util/createOverlayRender";

import MediaGalleryOverlay, {
  type MediaGalleryMode,
  type MediaGalleryOverlayRenderProps,
} from "~/components/MediaGalleryOverlay";
import { clearSemanticIndex } from "~/utils/semantic";
import { createSemanticWorkerClient } from "~/utils/semantic/workerClient";
import { captureUploadParentUid } from "~/utils/media/roam";

const OPEN_MEDIA_GALLERY_COMMAND = "Open Media Gallery";
const BUILD_IMAGE_INDEX_COMMAND = "Media Gallery: Build Image Index";
const SEMANTIC_IMAGE_SEARCH_COMMAND = "Media Gallery: Semantic Image Search";

export default runExtension(async ({ extensionAPI }) => {
  const renderMediaGallery =
    createOverlayRender<MediaGalleryOverlayRenderProps>(
      "roamjs-media-gallery-overlay",
      MediaGalleryOverlay,
    );
  const semanticClient = createSemanticWorkerClient();
  let closeOverlay: (() => void) | undefined;

  const openMediaGallery = ({
    initialMode,
    autoStartBuild = false,
  }: {
    initialMode: MediaGalleryMode;
    autoStartBuild?: boolean;
  }): void => {
    const uploadParentUid = captureUploadParentUid();
    closeOverlay?.();
    closeOverlay = renderMediaGallery({
      semanticClient,
      initialMode,
      autoStartBuild,
      uploadParentUid,
    });
  };

  const clearCurrentGraphIndex = async (): Promise<void> => {
    const graphName = window.roamAlphaAPI.graph.name;
    if (
      !window.confirm(
        `Clear the semantic image index for "${graphName}"?\n\nIndexes for other graphs will not be changed.`,
      )
    ) {
      return;
    }
    try {
      await clearSemanticIndex({ graphName });
      renderToast({
        id: "media-gallery-settings-clear-index-success",
        content: `Cleared the image index for ${graphName}.`,
        intent: "success",
      });
    } catch (error) {
      renderToast({
        id: "media-gallery-settings-clear-index-error",
        content:
          error instanceof Error
            ? error.message
            : "Failed to clear the semantic image index.",
        intent: "danger",
      });
    }
  };

  extensionAPI.settings.panel.create({
    tabTitle: "Media Gallery",
    settings: [
      {
        id: "clear-semantic-image-index",
        name: "Semantic Image Index",
        description:
          "Clear only the local semantic image index for the current graph.",
        action: {
          type: "button",
          content: "Clear This Graph's Image Index",
          onClick: () => {
            clearCurrentGraphIndex().catch(() => undefined);
          },
        },
      },
    ],
  });

  if (process.env.NODE_ENV === "development") {
    renderToast({
      id: "media-gallery-loaded",
      content: "Successfully loaded Media Gallery",
      intent: "success",
      timeout: 500,
    });
  }

  await extensionAPI.ui.commandPalette.addCommand({
    label: OPEN_MEDIA_GALLERY_COMMAND,
    callback: () => {
      openMediaGallery({ initialMode: "keyword" });
    },
  });

  await extensionAPI.ui.commandPalette.addCommand({
    label: BUILD_IMAGE_INDEX_COMMAND,
    callback: () => {
      openMediaGallery({ initialMode: "semantic", autoStartBuild: true });
    },
  });

  await extensionAPI.ui.commandPalette.addCommand({
    label: SEMANTIC_IMAGE_SEARCH_COMMAND,
    callback: () => {
      openMediaGallery({ initialMode: "semantic" });
    },
  });

  return {
    commands: [
      OPEN_MEDIA_GALLERY_COMMAND,
      BUILD_IMAGE_INDEX_COMMAND,
      SEMANTIC_IMAGE_SEARCH_COMMAND,
    ],
    unload: () => {
      closeOverlay?.();
      semanticClient.terminate();
    },
  };
});
