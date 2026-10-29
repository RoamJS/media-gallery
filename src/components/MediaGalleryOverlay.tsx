import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Button,
  ButtonGroup,
  Callout,
  Dialog,
  HTMLSelect,
  InputGroup,
  Spinner,
} from "@blueprintjs/core";
import { render as renderToast } from "roamjs-components/components/Toast";

import { downloadMediaFile } from "~/utils/media/clipboard";
import MediaCard from "~/components/MediaCard";
import MediaPreviewDialog from "~/components/MediaPreviewDialog";
import SemanticPanel from "~/components/SemanticPanel";
import {
  createMediaDimensionCache,
  type MediaDimensionProgress,
} from "~/utils/media/dimensions";

import type { MediaFilters, MediaItem } from "~/types/media";
import type {
  SemanticBuildReport,
  SemanticIndexSummary,
  SemanticProgress,
  SemanticSearchResult,
  SemanticWorkerClient,
} from "~/types/semantic";
import {
  applyMediaFilters,
  applySemanticResultFilters,
} from "~/utils/media/filter";
import {
  copyMediaFile,
  copyTextToClipboard,
  getFileByUrl,
  formatUploadedMediaReference,
  openMediaItemReferences,
  openMediaItemSource,
  queryAllMediaItems,
  uploadFileAndCreateReference,
  withFileMetadata,
  withImageDimensions,
} from "~/utils/media/roam";
import {
  buildSemanticIndex,
  areSemanticModelsEqual,
  clearSemanticIndex,
  getSemanticIndexSummary,
  searchSemanticIndex,
  SEMANTIC_MODEL_INFO,
  SEMANTIC_SEARCH_LIMIT,
  SemanticModelMismatchError,
} from "~/utils/semantic";

export type MediaGalleryMode = "keyword" | "semantic";

export type MediaGalleryOverlayRenderProps = {
  semanticClient: SemanticWorkerClient;
  initialMode?: MediaGalleryMode;
  autoStartBuild?: boolean;
  uploadParentUid?: string | null;
};

type MediaGalleryOverlayProps = MediaGalleryOverlayRenderProps & {
  isOpen: boolean;
  onClose: () => void;
};

const DEFAULT_FILTERS: MediaFilters = {
  query: "",
  author: "all",
  mediaType: "all",
  orientation: "all",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: "",
  sortBy: "updated",
  sortDirection: "desc",
};

const toFiles = (list: FileList | File[]): File[] => Array.from(list);

type PendingUpload = {
  file: File;
  fileName: string;
};

type RefreshOptions = {
  expectedUrls?: string[];
};

type SemanticOperation = "building" | "searching" | "clearing" | null;

type GalleryResult = {
  item: MediaItem;
  semanticResult?: SemanticSearchResult;
};

const toPendingUploads = (list: FileList | File[]): PendingUpload[] =>
  toFiles(list).map((file) => ({ file, fileName: file.name }));

const getFileExtension = (fileName: string): string => {
  const match = fileName.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || "";
};

const toFallbackMediaItem = ({
  result,
}: {
  result: SemanticSearchResult;
}): MediaItem => {
  const reference = result.preferredReference;
  return {
    id: result.mediaId,
    url: result.url,
    fileName: result.fileName,
    extension: getFileExtension(result.fileName),
    searchText: `${result.fileName} ${result.url}`.toLowerCase(),
    mediaType: result.mediaType,
    mimeType: result.mimeType,
    sizeBytes: null,
    width: null,
    height: null,
    orientation: "unknown",
    createdTime: reference?.createdTime ?? null,
    updatedTime: reference?.updatedTime ?? null,
    authors: reference
      ? [reference.updatedAuthor || reference.createdAuthor].filter(Boolean)
      : [],
    references: reference ? [reference] : [],
  };
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const MediaGalleryOverlay = ({
  isOpen,
  onClose,
  semanticClient,
  initialMode = "keyword",
  autoStartBuild = false,
  uploadParentUid,
}: MediaGalleryOverlayProps): React.ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigatingRef = useRef(false);
  const [dimensionCache] = useState(() => createMediaDimensionCache());
  const itemsRef = useRef<MediaItem[]>([]);
  const refreshGenerationRef = useRef(0);
  const [queryRevision, setQueryRevision] = useState(0);
  const [dimensionProgress, setDimensionProgress] =
    useState<MediaDimensionProgress | null>(null);
  const [dimensionFailures, setDimensionFailures] = useState(0);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadingById, setDownloadingById] = useState<
    Record<string, boolean>
  >({});
  const [indexStale, setIndexStale] = useState(false);
  const uploadBusyRef = useRef(false);
  const semanticSummaryGenerationRef = useRef(0);
  const semanticSavingRef = useRef(false);
  const semanticBusyRef = useRef<boolean>(false);
  const semanticAbortRef = useRef<AbortController | null>(null);
  const autoBuildStartedRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(false);
  const graphName = window.roamAlphaAPI.graph.name;
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filters, setFilters] = useState<MediaFilters>(DEFAULT_FILTERS);
  const [mode, setMode] = useState<MediaGalleryMode>(initialMode);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copyingById, setCopyingById] = useState<Record<string, boolean>>({});
  const [semanticQuery, setSemanticQuery] = useState<string>("");
  const [semanticSearchedQuery, setSemanticSearchedQuery] =
    useState<string>("");
  const [semanticResults, setSemanticResults] = useState<
    SemanticSearchResult[]
  >([]);
  const [semanticSummary, setSemanticSummary] =
    useState<SemanticIndexSummary | null>(null);
  const [semanticSummaryLoading, setSemanticSummaryLoading] =
    useState<boolean>(false);
  const [semanticOperation, setSemanticOperation] =
    useState<SemanticOperation>(null);
  const [semanticProgress, setSemanticProgress] =
    useState<SemanticProgress | null>(null);
  const [semanticError, setSemanticError] = useState<string>("");
  const [semanticBuildReport, setSemanticBuildReport] =
    useState<SemanticBuildReport | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      semanticAbortRef.current?.abort();
    };
  }, []);

  const refreshItems = useCallback(
    async ({ expectedUrls = [] }: RefreshOptions = {}): Promise<void> => {
      const generation = ++refreshGenerationRef.current;
      dimensionCache.clearFailures();
      setLoading(true);
      setError("");
      try {
        let mediaItems = await queryAllMediaItems();
        for (
          let attempt = 0;
          attempt < 2 &&
          expectedUrls.some(
            (url) => !mediaItems.some((item) => item.url === url),
          );
          attempt += 1
        ) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          mediaItems = await queryAllMediaItems();
        }
        if (!mountedRef.current || generation !== refreshGenerationRef.current)
          return;
        if (
          itemsRef.current.length &&
          itemsRef.current
            .map(({ url }) => url)
            .sort()
            .join("\n") !==
            mediaItems
              .map(({ url }) => url)
              .sort()
              .join("\n")
        )
          setIndexStale(true);
        const measured = dimensionCache.apply(mediaItems);
        itemsRef.current = measured;
        setItems(measured);
        setQueryRevision((value) => value + 1);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to query media.";
        if (mountedRef.current && generation === refreshGenerationRef.current)
          setError(message);
      } finally {
        if (mountedRef.current && generation === refreshGenerationRef.current)
          setLoading(false);
      }
    },
    [dimensionCache],
  );

  React.useEffect(() => {
    refreshItems().catch(() => undefined);
  }, [refreshItems]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    if (filters.orientation === "all" || loading) {
      setDimensionProgress(null);
      return;
    }
    const controller = new AbortController();
    dimensionCache
      .measure({
        items: itemsRef.current,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setDimensionProgress(progress);
        },
        onDimensions: ({ url, width, height }) => {
          if (!controller.signal.aborted)
            setItems((current) =>
              current.map((item) =>
                item.url === url
                  ? withImageDimensions({ item, width, height })
                  : item,
              ),
            );
        },
      })
      .then((result) => {
        if (!controller.signal.aborted) setDimensionFailures(result.failed);
      })
      .catch((measurementError: unknown) => {
        if (!isAbortError(measurementError))
          setError("Could not check image dimensions. Refresh to retry.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDimensionProgress(null);
      });
    return () => controller.abort();
  }, [dimensionCache, filters.orientation, loading, mode, queryRevision]);

  const authors = useMemo(
    () =>
      Array.from(new Set(items.flatMap((item) => item.authors)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const filteredItems = useMemo(
    () => applyMediaFilters({ items, filters }),
    [items, filters],
  );

  const filteredSemanticResults = useMemo(
    () =>
      applySemanticResultFilters({ results: semanticResults, items, filters }),
    [semanticResults, items, filters],
  );

  const galleryResults = useMemo<GalleryResult[]>(() => {
    if (mode === "keyword") {
      return filteredItems.map((item) => ({ item }));
    }

    const itemsByUrl = new Map(items.map((item) => [item.url, item]));
    return filteredSemanticResults
      .slice(0, SEMANTIC_SEARCH_LIMIT)
      .map((semanticResult) => {
        const currentItem = itemsByUrl.get(semanticResult.url);
        const isCurrentItemImageLike =
          currentItem?.mediaType === "image" ||
          currentItem?.mediaType === "gif";
        return {
          item:
            currentItem && isCurrentItemImageLike
              ? currentItem
              : toFallbackMediaItem({ result: semanticResult }),
          semanticResult,
        };
      });
  }, [filteredItems, items, mode, filteredSemanticResults]);
  const semanticLimitReached =
    mode === "semantic" &&
    Boolean(semanticSearchedQuery) &&
    galleryResults.length >= SEMANTIC_SEARCH_LIMIT;

  const refreshSemanticSummary = useCallback(async (): Promise<void> => {
    if (semanticBusyRef.current) return;
    const generation = ++semanticSummaryGenerationRef.current;
    setSemanticSummaryLoading(true);
    try {
      const summary = await getSemanticIndexSummary({ graphName });
      if (
        mountedRef.current &&
        generation === semanticSummaryGenerationRef.current
      ) {
        setSemanticSummary(summary);
      }
    } catch (semanticSummaryError) {
      if (
        mountedRef.current &&
        generation === semanticSummaryGenerationRef.current
      ) {
        setSemanticError(
          semanticSummaryError instanceof Error
            ? semanticSummaryError.message
            : "Failed to read the semantic image index.",
        );
      }
    } finally {
      if (
        mountedRef.current &&
        generation === semanticSummaryGenerationRef.current
      ) {
        setSemanticSummaryLoading(false);
      }
    }
  }, [graphName]);

  React.useEffect(() => {
    if (mode !== "semantic") {
      return;
    }
    setSemanticError("");
    refreshSemanticSummary().catch(() => undefined);
  }, [mode, refreshSemanticSummary]);

  const cancelSemanticOperation = useCallback((): void => {
    if (semanticSavingRef.current) return;
    semanticAbortRef.current?.abort();
    semanticAbortRef.current = null;
    semanticBusyRef.current = false;
    setSemanticOperation(null);
    setSemanticProgress(null);
  }, []);

  const beginSemanticOperation = (
    operation: Exclude<SemanticOperation, null>,
  ): AbortController => {
    const controller = new AbortController();
    semanticSummaryGenerationRef.current += 1;
    setSemanticSummaryLoading(false);
    semanticSavingRef.current = false;
    semanticAbortRef.current = controller;
    semanticBusyRef.current = true;
    setSemanticOperation(operation);
    setSemanticError("");
    return controller;
  };
  const isCurrentOperation = (controller: AbortController): boolean =>
    mountedRef.current &&
    semanticAbortRef.current === controller &&
    !controller.signal.aborted;
  const finishSemanticOperation = (controller: AbortController): void => {
    if (!isCurrentOperation(controller)) return;
    semanticSavingRef.current = false;
    semanticBusyRef.current = false;
    semanticAbortRef.current = null;
    setSemanticOperation(null);
    setSemanticProgress(null);
  };

  const onBuildSemanticIndex = async (): Promise<void> => {
    if (loading || uploading || semanticBusyRef.current) return;
    const controller = beginSemanticOperation("building");
    setSemanticBuildReport(null);
    setSemanticProgress({
      phase: "hashing",
      completed: 0,
      total: 0,
      message: "Preparing the image index…",
    });
    try {
      const report = await buildSemanticIndex({
        graphName,
        items,
        client: semanticClient,
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrentOperation(controller)) {
            semanticSavingRef.current = progress.phase === "saving";
            setSemanticProgress(progress);
          }
        },
      });
      if (!isCurrentOperation(controller)) return;
      setSemanticBuildReport(report);
      setSemanticSummary(report.summary);
      setIndexStale(false);
      setSemanticResults([]);
      setSemanticSearchedQuery("");
    } catch (buildError) {
      if (isCurrentOperation(controller) && !isAbortError(buildError))
        setSemanticError(
          buildError instanceof Error
            ? buildError.message
            : "Failed to build the image index.",
        );
    } finally {
      finishSemanticOperation(controller);
    }
  };

  React.useEffect(() => {
    if (
      !autoStartBuild ||
      mode !== "semantic" ||
      loading ||
      error ||
      autoBuildStartedRef.current
    )
      return;
    autoBuildStartedRef.current = true;
    // The command is an explicit request to build; show the first-download notice before starting.
    if (
      window.confirm(
        `Build this graph's image index? The first build downloads about 90 MB and processes images in your browser.`,
      )
    )
      void onBuildSemanticIndex();
  }, [autoStartBuild, error, loading, mode]);

  const onSemanticSearch = async (): Promise<void> => {
    const query = semanticQuery.trim();
    if (!query || semanticBusyRef.current) return;
    const controller = beginSemanticOperation("searching");
    setSemanticProgress({
      phase: "searching",
      completed: 0,
      total: 1,
      message: "Searching the local image index…",
    });
    try {
      const currentSummary = await getSemanticIndexSummary({ graphName });
      if (!isCurrentOperation(controller)) return;
      setSemanticSummary(currentSummary);
      if (!currentSummary.exists) {
        setSemanticResults([]);
        return;
      }
      const results = await searchSemanticIndex({
        graphName,
        query,
        limit: currentSummary.itemCount,
        client: semanticClient,
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrentOperation(controller)) {
            semanticSavingRef.current = progress.phase === "saving";
            setSemanticProgress(progress);
          }
        },
      });
      if (!isCurrentOperation(controller)) return;
      setSemanticResults(results);
      setSemanticSearchedQuery(query);
    } catch (searchError) {
      if (isCurrentOperation(controller) && !isAbortError(searchError))
        setSemanticError(
          searchError instanceof SemanticModelMismatchError
            ? "This image index needs to be rebuilt for the current model. Choose Update index."
            : searchError instanceof Error
              ? searchError.message
              : "Image search failed.",
        );
    } finally {
      finishSemanticOperation(controller);
    }
  };

  const onClearSemanticIndex = async (): Promise<void> => {
    if (
      semanticBusyRef.current ||
      !window.confirm(
        `Clear the image index for "${graphName}"? Your images, block references, and other graphs' indexes will remain.`,
      )
    )
      return;
    const controller = beginSemanticOperation("clearing");
    setSemanticProgress({
      phase: "saving",
      completed: 0,
      total: 1,
      message: "Clearing this graph's image index…",
    });
    try {
      await clearSemanticIndex({ graphName });
      const summary = await getSemanticIndexSummary({ graphName });
      if (!isCurrentOperation(controller)) return;
      setSemanticSummary(summary);
      setSemanticResults([]);
      setSemanticSearchedQuery("");
      setSemanticBuildReport(null);
      setIndexStale(false);
    } catch (clearError) {
      if (isCurrentOperation(controller))
        setSemanticError(
          clearError instanceof Error
            ? clearError.message
            : "Failed to clear the image index.",
        );
    } finally {
      finishSemanticOperation(controller);
    }
  };

  const updateFilter = useCallback(
    <K extends keyof MediaFilters>(key: K, value: MediaFilters[K]): void => {
      setFilters((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [],
  );

  const applyUploadedFiles = useCallback(
    async (uploads: PendingUpload[]): Promise<void> => {
      if (!uploads.length || uploadBusyRef.current || semanticBusyRef.current)
        return;
      uploadBusyRef.current = true;
      setUploading(true);
      const uploadedUrls: string[] = [];
      try {
        for (const { file, fileName } of uploads) {
          uploadedUrls.push(
            await uploadFileAndCreateReference({
              file,
              fileName,
              parentUid: uploadParentUid,
            }),
          );
        }
        renderToast({
          id: "media-gallery-upload-success",
          content: `Uploaded ${uploads.length} file${uploads.length === 1 ? "" : "s"}.`,
          intent: "success",
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed.";
        renderToast({
          id: "media-gallery-upload-error",
          content: message,
          intent: "danger",
        });
      } finally {
        if (uploadedUrls.length) {
          setIndexStale(true);
          await refreshItems({ expectedUrls: uploadedUrls });
        }
        uploadBusyRef.current = false;
        setUploading(false);
        setDragging(false);
      }
    },
    [refreshItems, uploadParentUid],
  );

  const onFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const fallbackFileName = event.target.value.split(/[\\/]/).pop() || "";
      const uploads = toPendingUploads(event.target.files || []).map(
        (upload, index) => ({
          ...upload,
          fileName:
            upload.fileName ||
            (index === 0 ? fallbackFileName : "Uploaded media"),
        }),
      );
      await applyUploadedFiles(uploads);
      event.target.value = "";
    },
    [applyUploadedFiles],
  );

  const onCopyUrl = useCallback(
    async ({ item }: { item: MediaItem }): Promise<void> => {
      try {
        await copyTextToClipboard({ text: item.url });
        renderToast({
          id: `media-gallery-copy-url-${item.id}`,
          content: "Copied URL.",
          intent: "success",
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to copy URL.";
        renderToast({
          id: `media-gallery-copy-url-error-${item.id}`,
          content: message,
          intent: "danger",
        });
      }
    },
    [],
  );

  const onOpenSource = useCallback(
    async ({ item }: { item: MediaItem }): Promise<void> => {
      try {
        await openMediaItemSource({ item });
        navigatingRef.current = true;
        setPreviewOpen(false);
        onClose();
      } catch (sourceError) {
        renderToast({
          id: `media-gallery-open-source-error-${item.id}`,
          content:
            sourceError instanceof Error
              ? sourceError.message
              : "Failed to open the media source.",
          intent: "danger",
        });
      }
    },
    [onClose],
  );

  const onOpenReferences = useCallback(
    async (item: MediaItem): Promise<void> => {
      try {
        await openMediaItemReferences({ item });
        navigatingRef.current = true;
        setPreviewOpen(false);
        onClose();
      } catch (referenceError) {
        renderToast({
          id: `media-gallery-references-error-${item.id}`,
          content:
            referenceError instanceof Error
              ? referenceError.message
              : "Failed to open references.",
          intent: "danger",
        });
      }
    },
    [onClose],
  );

  const onCopyMarkdown = useCallback(async (item: MediaItem): Promise<void> => {
    try {
      await copyTextToClipboard({ text: formatUploadedMediaReference(item) });
      renderToast({
        id: `media-gallery-markdown-${item.id}`,
        content: "Copied Markdown.",
        intent: "success",
      });
    } catch (copyError) {
      renderToast({
        id: `media-gallery-markdown-error-${item.id}`,
        content:
          copyError instanceof Error
            ? copyError.message
            : "Failed to copy Markdown.",
        intent: "danger",
      });
    }
  }, []);

  const onCopyFile = useCallback(
    async ({ item }: { item: MediaItem }): Promise<void> => {
      setCopyingById((current) => ({ ...current, [item.id]: true }));
      try {
        const outcome = await copyMediaFile({
          url: item.url,
          fileName: item.fileName,
          mimeType: item.mimeType,
        });
        const { file } = outcome;
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? withFileMetadata({ item: candidate, file })
              : candidate,
          ),
        );
        renderToast({
          id: `media-gallery-copy-file-${item.id}`,
          content:
            outcome.status === "copied"
              ? outcome.convertedToPng
                ? "Copied image as PNG."
                : "Copied image."
              : outcome.reason === "unsupported-format"
                ? "Download started. This format cannot be copied as a file."
                : "Download started because the browser could not copy this image.",
          intent: "success",
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to copy file to clipboard.";
        renderToast({
          id: `media-gallery-copy-file-error-${item.id}`,
          content: message,
          intent: "danger",
        });
      } finally {
        setCopyingById((current) => ({ ...current, [item.id]: false }));
      }
    },
    [],
  );

  const onDownload = async (item: MediaItem): Promise<void> => {
    setDownloadingById((current) => ({ ...current, [item.id]: true }));
    try {
      const file = await getFileByUrl({ url: item.url });
      await downloadMediaFile({ file, fileName: item.fileName });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? withFileMetadata({ item: candidate, file })
            : candidate,
        ),
      );
    } catch (downloadError) {
      renderToast({
        id: "media-gallery-feedback",
        content:
          downloadError instanceof Error
            ? downloadError.message
            : "Download failed.",
        intent: "danger",
      });
    } finally {
      setDownloadingById((current) => ({ ...current, [item.id]: false }));
    }
  };

  const onDropFiles = useCallback(
    async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault();
      setDragging(false);
      await applyUploadedFiles(toPendingUploads(event.dataTransfer.files));
    },
    [applyUploadedFiles],
  );

  const onImageLoad = useCallback(
    ({ itemId, image }: { itemId: string; image: HTMLImageElement }): void => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) {
        return;
      }
      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? (dimensionCache.remember({ url: item.url, width, height }),
              withImageDimensions({ item, width, height }))
            : item,
        ),
      );
    },
    [dimensionCache],
  );

  const onContainerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!event.dataTransfer.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      setDragging(true);
    },
    [],
  );

  const onContainerDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!event.dataTransfer.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      setDragging(true);
    },
    [],
  );

  const onContainerDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const related = event.relatedTarget as Node | null;
      if (!related || !event.currentTarget.contains(related)) {
        setDragging(false);
      }
    },
    [],
  );

  const activeFilterCount = (
    [
      "author",
      "mediaType",
      "orientation",
      "createdFrom",
      "createdTo",
      "updatedFrom",
      "updatedTo",
    ] as const
  ).filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
  const activePreviewItem = previewItem
    ? items.find((item) => item.id === previewItem.id) || previewItem
    : null;
  const mediaActions = {
    onOpenSource: (item: MediaItem): void => {
      void onOpenSource({ item });
    },
    onCopyUrl: (item: MediaItem): void => {
      void onCopyUrl({ item });
    },
    onCopyFile: (item: MediaItem): void => {
      void onCopyFile({ item });
    },
    onDownload: (item: MediaItem): void => {
      void onDownload(item);
    },
  };

  return (
    <>
      <Dialog
        title="Media Gallery"
        icon="media"
        isOpen={isOpen}
        onClose={onClose}
        autoFocus
        enforceFocus={!previewOpen}
        canEscapeKeyClose={!previewOpen}
        shouldReturnFocusOnClose={!navigatingRef.current}
        onOpened={() => searchRef.current?.focus()}
        className="roamjs-media-gallery-dialog"
      >
        <div
          className="roamjs-media-gallery-dialog-body bp3-dialog-body"
          onDragOver={onContainerDragOver}
          onDragEnter={onContainerDragEnter}
          onDragLeave={onContainerDragLeave}
          onDrop={(event) => void onDropFiles(event)}
        >
          <div className="roamjs-media-gallery-toolbar">
            <ButtonGroup
              className="roamjs-media-gallery-modes"
              aria-label="Gallery search mode"
            >
              <Button
                minimal
                text="Keyword"
                active={mode === "keyword"}
                aria-pressed={mode === "keyword"}
                onClick={() => {
                  if (semanticOperation && semanticOperation !== "clearing")
                    cancelSemanticOperation();
                  setMode("keyword");
                }}
              />
              <Button
                minimal
                text="Semantic"
                active={mode === "semantic"}
                aria-pressed={mode === "semantic"}
                onClick={() => {
                  setMode("semantic");
                }}
              />
            </ButtonGroup>
            <InputGroup
              inputRef={searchRef}
              leftIcon="search"
              aria-label={
                mode === "keyword" ? "Search media" : "Describe an image"
              }
              placeholder={
                mode === "keyword"
                  ? "Search by file name, URL, or block author"
                  : 'Describe an image, such as "sunset over water"'
              }
              value={mode === "keyword" ? filters.query : semanticQuery}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                if (mode === "keyword")
                  updateFilter("query", event.target.value);
                else {
                  if (semanticOperation === "searching")
                    cancelSemanticOperation();
                  setSemanticQuery(event.target.value);
                  setSemanticResults([]);
                  setSemanticSearchedQuery("");
                }
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (mode === "semantic" && event.key === "Enter") {
                  event.preventDefault();
                  void onSemanticSearch();
                }
              }}
              className="roamjs-media-gallery-search"
            />
            {mode === "semantic" ? (
              <Button
                minimal
                text="Search"
                icon="arrow-right"
                disabled={
                  !semanticQuery.trim() ||
                  Boolean(semanticOperation) ||
                  !semanticSummary?.exists
                }
                onClick={() => void onSemanticSearch()}
              />
            ) : null}
          </div>
          <div className="roamjs-media-gallery-tools">
            <Button
              minimal
              text="Upload"
              icon="upload"
              loading={uploading}
              disabled={Boolean(semanticOperation)}
              onClick={() => inputRef.current?.click()}
            />
            <Button
              minimal
              text="Refresh"
              icon="refresh"
              loading={loading}
              disabled={uploading || Boolean(semanticOperation)}
              onClick={() => void refreshItems()}
            />
            <>
              <Button
                minimal
                text={`Filters${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
                icon="filter"
                active={showFilters}
                aria-expanded={showFilters}
                aria-controls="media-gallery-filters"
                onClick={() => setShowFilters((current) => !current)}
              />
              {activeFilterCount ||
              filters.query ||
              filters.sortBy !== DEFAULT_FILTERS.sortBy ||
              filters.sortDirection !== DEFAULT_FILTERS.sortDirection ? (
                <Button
                  minimal
                  text="Reset"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                />
              ) : null}
            </>
            <span className="roamjs-media-gallery-hint">
              Drop files here to upload
            </span>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              aria-label="Choose files to upload"
              onChange={(event) => void onFileInputChange(event)}
            />
          </div>
          {showFilters ? (
            <div
              id="media-gallery-filters"
              className="roamjs-media-gallery-filter-panel"
              aria-label="Media filters"
            >
              <div className="roamjs-media-gallery-filter-grid">
                <label title="People who created or last edited Roam blocks that reference the file.">
                  Block author
                  <HTMLSelect
                    aria-label="Block author"
                    value={filters.author}
                    onChange={(event) =>
                      updateFilter("author", event.target.value)
                    }
                  >
                    <option value="all">All block authors</option>
                    {authors.map((author, index) => (
                      <option key={author} value={author}>
                        {/^[a-z0-9_-]{20,}$/i.test(author)
                          ? `Unknown block author ${index + 1}`
                          : author}
                      </option>
                    ))}
                  </HTMLSelect>
                </label>
                <label>
                  Media type
                  <HTMLSelect
                    aria-label="Media type"
                    value={filters.mediaType}
                    onChange={(event) =>
                      updateFilter(
                        "mediaType",
                        event.target.value as MediaFilters["mediaType"],
                      )
                    }
                  >
                    <option value="all">All types</option>
                    {[
                      "image",
                      "gif",
                      "video",
                      "audio",
                      "pdf",
                      "document",
                      "other",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {type === "gif" || type === "pdf"
                          ? type.toUpperCase()
                          : type.charAt(0).toUpperCase() + type.slice(1)}
                      </option>
                    ))}
                  </HTMLSelect>
                </label>
                <label>
                  Orientation
                  <HTMLSelect
                    aria-label="Orientation"
                    value={filters.orientation}
                    onChange={(event) =>
                      updateFilter(
                        "orientation",
                        event.target.value as MediaFilters["orientation"],
                      )
                    }
                  >
                    <option value="all">All orientations</option>
                    {["landscape", "portrait", "square", "unknown"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value.charAt(0).toUpperCase() + value.slice(1)}
                        </option>
                      ),
                    )}
                  </HTMLSelect>
                </label>
                {mode === "keyword" ? (
                  <>
                    <label>
                      Sort by
                      <HTMLSelect
                        aria-label="Sort by"
                        value={filters.sortBy}
                        onChange={(event) =>
                          updateFilter(
                            "sortBy",
                            event.target.value as MediaFilters["sortBy"],
                          )
                        }
                      >
                        <option value="updated">Reference updated</option>
                        <option value="created">Reference created</option>
                      </HTMLSelect>
                    </label>
                    <label>
                      Sort order
                      <HTMLSelect
                        aria-label="Sort order"
                        value={filters.sortDirection}
                        onChange={(event) =>
                          updateFilter(
                            "sortDirection",
                            event.target.value as MediaFilters["sortDirection"],
                          )
                        }
                      >
                        <option value="desc">Newest first</option>
                        <option value="asc">Oldest first</option>
                      </HTMLSelect>
                    </label>
                  </>
                ) : null}
              </div>
              <div className="roamjs-media-gallery-date-grid">
                {(
                  [
                    ["createdFrom", "Reference created from"],
                    ["createdTo", "Reference created to"],
                    ["updatedFrom", "Reference updated from"],
                    ["updatedTo", "Reference updated to"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="date"
                      aria-label={label}
                      className="bp3-input"
                      value={filters[key]}
                      onChange={(event) =>
                        updateFilter(key, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="roamjs-media-gallery-filter-note">
                Dates belong to referring Roam blocks, not file uploads.
                {mode === "semantic"
                  ? " Filters apply to all indexed images; results stay ordered by similarity."
                  : ""}
              </p>
            </div>
          ) : null}
          {error ? (
            <Callout intent="danger" title="Could not load media">
              {error}
              <Button
                minimal
                text="Try again"
                onClick={() => void refreshItems()}
              />
            </Callout>
          ) : null}
          <div
            className="roamjs-media-gallery-results-header"
            aria-live="polite"
            role="status"
          >
            <span className="roamjs-media-gallery-count">
              {mode === "keyword"
                ? `${galleryResults.length} of ${items.length} files`
                : semanticSearchedQuery
                  ? semanticLimitReached
                    ? `Top ${SEMANTIC_SEARCH_LIMIT} of ${filteredSemanticResults.length} indexed images for “${semanticSearchedQuery}”`
                    : `${galleryResults.length} ranked image${galleryResults.length === 1 ? "" : "s"} for “${semanticSearchedQuery}”`
                  : "Search images by description"}
            </span>
            {mode === "semantic" && semanticSearchedQuery ? (
              <span className="roamjs-media-gallery-hint">
                Closest images first ·{" "}
                {semanticLimitReached
                  ? `Maximum ${SEMANTIC_SEARCH_LIMIT} results per search`
                  : "Results may include weak similarities"}
              </span>
            ) : dimensionProgress ? (
              <span className="roamjs-media-gallery-hint">
                Checking image dimensions… {dimensionProgress.completed}/
                {dimensionProgress.total}
              </span>
            ) : filters.orientation !== "all" && dimensionFailures ? (
              <span className="roamjs-media-gallery-hint">
                {dimensionFailures} image dimensions unavailable. Refresh to
                retry.
              </span>
            ) : null}
          </div>
          <div
            className="roamjs-media-gallery-results"
            aria-busy={loading || Boolean(dimensionProgress)}
          >
            {loading ? (
              <div className="roamjs-media-gallery-loading" role="status">
                <Spinner size={24} />
                <span>Loading media…</span>
              </div>
            ) : galleryResults.length ? (
              <ul
                className="roamjs-media-gallery-grid"
                aria-label="Media results"
              >
                {galleryResults.map(({ item, semanticResult }) => (
                  <li key={item.id}>
                    <MediaCard
                      item={item}
                      similarityScore={semanticResult?.score}
                      copying={copyingById[item.id]}
                      downloading={downloadingById[item.id]}
                      {...mediaActions}
                      onImageLoad={onImageLoad}
                      onPreview={(selected) => {
                        setPreviewItem(selected);
                        setPreviewOpen(true);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="roamjs-media-gallery-empty">
                {dimensionProgress ? (
                  <>
                    <Spinner size={24} />
                    <h3>Checking image dimensions…</h3>
                  </>
                ) : (
                  <>
                    <h3>
                      {mode === "semantic"
                        ? semanticSearchedQuery
                          ? activeFilterCount
                            ? "No indexed images match these filters"
                            : "No indexed images available"
                          : semanticSummary?.exists
                            ? "What are you looking for?"
                            : "Your images, searchable by description"
                        : items.length
                          ? "No media matches these filters"
                          : "No media yet"}
                    </h3>
                    <p>
                      {mode === "semantic"
                        ? semanticSearchedQuery
                          ? activeFilterCount
                            ? "Change or reset your filters to include more images."
                            : "Try a different description."
                          : semanticSummary?.exists
                            ? "Describe an image above to search this graph's index."
                            : "Build an image index to get started."
                        : items.length
                          ? "Try a different search or reset your filters."
                          : "Upload a file or add a media link to a block in this graph."}
                    </p>
                    {items.length &&
                    (mode === "keyword" || activeFilterCount) ? (
                      <Button
                        minimal
                        text="Reset filters"
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                      />
                    ) : null}
                  </>
                )}
              </div>
            )}
            {semanticLimitReached ? (
              <p className="roamjs-media-gallery-result-limit" role="note">
                Maximum {SEMANTIC_SEARCH_LIMIT} results per semantic search.
              </p>
            ) : null}
          </div>
          {mode === "semantic" ? (
            <SemanticPanel
              graphName={graphName}
              summary={semanticSummary}
              summaryLoading={semanticSummaryLoading}
              loading={loading}
              operation={semanticOperation}
              progress={semanticProgress}
              buildReport={semanticBuildReport}
              error={semanticError}
              indexStale={
                indexStale ||
                Boolean(
                  semanticSummary?.model &&
                  !areSemanticModelsEqual({
                    a: semanticSummary.model,
                    b: SEMANTIC_MODEL_INFO,
                  }),
                )
              }
              onBuild={() => void onBuildSemanticIndex()}
              onCancel={cancelSemanticOperation}
              onClear={() => void onClearSemanticIndex()}
            />
          ) : null}
          {dragging ? (
            <div
              className="roamjs-media-gallery-drop-target"
              aria-hidden="true"
            >
              Drop files to upload
            </div>
          ) : null}
        </div>
      </Dialog>
      <MediaPreviewDialog
        item={activePreviewItem}
        isOpen={previewOpen && isOpen}
        onClose={() => setPreviewOpen(false)}
        onClosed={() => setPreviewItem(null)}
        copying={activePreviewItem ? copyingById[activePreviewItem.id] : false}
        downloading={
          activePreviewItem ? downloadingById[activePreviewItem.id] : false
        }
        {...mediaActions}
        onOpenReferences={(item) => void onOpenReferences(item)}
        onCopyMarkdown={(item) => void onCopyMarkdown(item)}
      />
    </>
  );
};

export default MediaGalleryOverlay;
