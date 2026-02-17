import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  HTMLSelect,
  Icon,
  InputGroup,
  Spinner,
} from "@blueprintjs/core";
import { render as renderToast } from "roamjs-components/components/Toast";

import type { MediaFilters, MediaItem } from "~/types/media";
import { applyMediaFilters } from "~/utils/media/filter";
import {
  copyFileToClipboard,
  copyTextToClipboard,
  deleteFileByUrl,
  getFileByUrl,
  queryAllMediaItems,
  uploadFileAndCreateReference,
  withFileMetadata,
  withImageDimensions,
} from "~/utils/media/roam";

type MediaGalleryOverlayProps = {
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

const formatDate = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : "Unknown";

const formatSize = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) {
    return "Unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const toFiles = (list: FileList | File[]): File[] => Array.from(list);

const MediaGalleryOverlay = ({
  isOpen,
  onClose,
}: MediaGalleryOverlayProps): React.ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filters, setFilters] = useState<MediaFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [copyingById, setCopyingById] = useState<Record<string, boolean>>({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});

  const refreshItems = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const mediaItems = await queryAllMediaItems();
      setItems(mediaItems);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to query media.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshItems().catch(() => undefined);
  }, [refreshItems]);

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
    async (files: File[]): Promise<void> => {
      if (!files.length) {
        return;
      }
      setUploading(true);
      try {
        for (const file of files) {
          await uploadFileAndCreateReference({ file });
        }
        renderToast({
          id: "media-gallery-upload-success",
          content: `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`,
          intent: "success",
        });
        await refreshItems();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed.";
        renderToast({
          id: "media-gallery-upload-error",
          content: message,
          intent: "danger",
        });
      } finally {
        setUploading(false);
        setDragging(false);
      }
    },
    [refreshItems],
  );

  const onFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = toFiles(event.target.files || []);
      event.target.value = "";
      await applyUploadedFiles(files);
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

  const onCopyFile = useCallback(
    async ({ item }: { item: MediaItem }): Promise<void> => {
      setCopyingById((current) => ({ ...current, [item.id]: true }));
      try {
        const file = await getFileByUrl({ url: item.url });
        await copyFileToClipboard({ file });
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
            item.mediaType === "image" || item.mediaType === "gif"
              ? "Copied image."
              : "Copied file.",
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

  const onDelete = useCallback(
    async ({ item }: { item: MediaItem }): Promise<void> => {
      const confirmed = window.confirm(
        `Delete this file from Roam storage?\n\n${item.fileName}`,
      );
      if (!confirmed) {
        return;
      }
      setDeletingById((current) => ({ ...current, [item.id]: true }));
      try {
        await deleteFileByUrl({ url: item.url });
        setItems((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
        renderToast({
          id: `media-gallery-delete-${item.id}`,
          content: "Deleted file from Roam storage.",
          intent: "success",
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to delete file.";
        renderToast({
          id: `media-gallery-delete-error-${item.id}`,
          content: message,
          intent: "danger",
        });
      } finally {
        setDeletingById((current) => ({ ...current, [item.id]: false }));
      }
    },
    [],
  );

  const onDropFiles = useCallback(
    async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault();
      setDragging(false);
      await applyUploadedFiles(toFiles(event.dataTransfer.files));
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
            ? withImageDimensions({ item, width, height })
            : item,
        ),
      );
    },
    [],
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

  return (
    <Dialog
      title="Media Gallery"
      icon="media"
      isOpen={isOpen}
      onClose={onClose}
      autoFocus={false}
      enforceFocus={false}
      style={{
        width: "96vw",
        maxWidth: "96vw",
        height: "90vh",
        overflow: "hidden",
      }}
    >
      <div
        className="bp3-dialog-body relative !m-2 h-full min-h-0 overflow-hidden !p-0"
        onDragOver={onContainerDragOver}
        onDragEnter={onContainerDragEnter}
        onDragLeave={onContainerDragLeave}
        onDrop={(event) => onDropFiles(event).catch(() => undefined)}
      >
        <div className="flex h-full min-h-0 flex-col gap-2 p-1">
          <div className="flex flex-none shrink-0 flex-wrap items-center gap-2">
            <Button
              text="Refresh"
              icon="refresh"
              loading={loading}
              onClick={() => refreshItems().catch(() => undefined)}
            />
            <Button
              text="Upload"
              icon="upload"
              intent="primary"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            />
            <InputGroup
              leftIcon="search"
              placeholder="Search by file name, URL, or author"
              value={filters.query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateFilter("query", e.target.value)
              }
              className="min-w-[260px] grow"
            />
            <Button
              text={showFilters ? "Hide Filters" : "Show Filters"}
              icon="filter"
              onClick={() => setShowFilters((current) => !current)}
            />
            <Button
              text="Reset Filters"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            />
            <div className="text-xs text-slate-600">
              Showing {filteredItems.length} / {items.length}
            </div>
            <div className="text-xs text-slate-500">
              Drag and drop files anywhere in this panel to upload.
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFileInputChange(e).catch(() => undefined)}
            />
          </div>
          {showFilters ? (
            <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <HTMLSelect
                value={filters.author}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateFilter("author", e.target.value)
                }
              >
                <option value="all">All authors</option>
                {authors.map((author) => (
                  <option key={author} value={author}>
                    {author}
                  </option>
                ))}
              </HTMLSelect>
              <HTMLSelect
                value={filters.mediaType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateFilter(
                    "mediaType",
                    e.target.value as MediaFilters["mediaType"],
                  )
                }
              >
                <option value="all">All types</option>
                <option value="image">Images</option>
                <option value="gif">GIF</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="pdf">PDF</option>
                <option value="document">Document</option>
                <option value="other">Other</option>
              </HTMLSelect>
              <HTMLSelect
                value={filters.orientation}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateFilter(
                    "orientation",
                    e.target.value as MediaFilters["orientation"],
                  )
                }
              >
                <option value="all">All orientation</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
                <option value="square">Square</option>
                <option value="unknown">Unknown</option>
              </HTMLSelect>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-600">Created:</span>
                <input
                  type="date"
                  className="bp3-input"
                  value={filters.createdFrom}
                  onChange={(e) => updateFilter("createdFrom", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-600">to</span>
                <input
                  type="date"
                  className="bp3-input"
                  value={filters.createdTo}
                  onChange={(e) => updateFilter("createdTo", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-600">Updated:</span>
                <input
                  type="date"
                  className="bp3-input"
                  value={filters.updatedFrom}
                  onChange={(e) => updateFilter("updatedFrom", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-600">to</span>
                <input
                  type="date"
                  className="bp3-input"
                  value={filters.updatedTo}
                  onChange={(e) => updateFilter("updatedTo", e.target.value)}
                />
              </div>
              <HTMLSelect
                value={filters.sortBy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateFilter(
                    "sortBy",
                    e.target.value as MediaFilters["sortBy"],
                  )
                }
              >
                <option value="updated">Sort by updated</option>
                <option value="created">Sort by created</option>
              </HTMLSelect>
              <HTMLSelect
                value={filters.sortDirection}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  updateFilter(
                    "sortDirection",
                    e.target.value as MediaFilters["sortDirection"],
                  )
                }
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </HTMLSelect>
            </div>
          ) : null}
          {error ? (
            <Callout intent="danger" title="Failed to load media">
              {error}
            </Callout>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200 bg-slate-100/40 p-2">
            {loading ? (
              <div className="flex h-[40vh] items-center justify-center">
                <Spinner size={32} />
              </div>
            ) : filteredItems.length ? (
              <ul
                role="list"
                className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-3 p-0 sm:grid-cols-3 sm:gap-x-2 lg:grid-cols-5 xl:grid-cols-6"
              >
                {filteredItems.map((item) => {
                  const copying = Boolean(copyingById[item.id]);
                  const deleting = Boolean(deletingById[item.id]);
                  const isImageLike =
                    item.mediaType === "image" || item.mediaType === "gif";
                  return (
                    <li key={item.id} className="relative">
                      <div className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600">
                        {isImageLike ? (
                          <img
                            src={item.url}
                            className="pointer-events-none aspect-[10/7] w-full rounded-lg object-cover outline -outline-offset-1 outline-black/5 transition-opacity group-hover:opacity-80"
                            loading="lazy"
                            decoding="async"
                            alt={item.fileName}
                            onLoad={(event) =>
                              onImageLoad({
                                itemId: item.id,
                                image: event.currentTarget,
                              })
                            }
                          />
                        ) : item.mediaType === "video" ? (
                          <div className="aspect-[10/7] bg-black">
                            <video
                              src={item.url}
                              controls
                              preload="metadata"
                              className="h-full w-full rounded-lg object-cover"
                            />
                          </div>
                        ) : item.mediaType === "audio" ? (
                          <div className="flex aspect-[10/7] flex-col items-center justify-center gap-1 rounded-lg bg-slate-900 px-2 text-slate-100">
                            <Icon icon="volume-up" iconSize={24} />
                            <span className="text-[11px] font-medium uppercase tracking-wide">
                              Audio
                            </span>
                          </div>
                        ) : item.mediaType === "pdf" ? (
                          <div className="flex aspect-[10/7] flex-col items-center justify-center gap-1 rounded-lg bg-rose-50 text-rose-700">
                            <Icon icon="document" iconSize={24} />
                            <span className="text-[11px] font-medium uppercase tracking-wide">
                              PDF
                            </span>
                          </div>
                        ) : (
                          <div className="flex aspect-[10/7] flex-col items-center justify-center gap-1 rounded-lg bg-slate-200 p-2 text-center text-xs font-medium text-slate-600">
                            <Icon icon="document" iconSize={22} />
                            <span className="text-[11px] uppercase tracking-wide">
                              {item.mediaType}
                            </span>
                          </div>
                        )}
                        <div className="absolute right-1 top-1 flex flex-wrap gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                          <Button
                            small
                            minimal
                            icon="link"
                            text="URL"
                            onClick={() =>
                              onCopyUrl({ item }).catch(() => undefined)
                            }
                          />
                          <Button
                            small
                            minimal
                            icon="duplicate"
                            text={isImageLike ? "Copy" : "File"}
                            loading={copying}
                            onClick={() =>
                              onCopyFile({ item }).catch(() => undefined)
                            }
                          />
                          <Button
                            small
                            minimal
                            intent="danger"
                            icon="trash"
                            loading={deleting}
                            onClick={() =>
                              onDelete({ item }).catch(() => undefined)
                            }
                          />
                        </div>
                      </div>
                      <p className="mt-1 block truncate text-xs font-medium text-slate-900">
                        {item.fileName}
                      </p>
                      <p className="block truncate text-[11px] text-slate-500">
                        {formatSize(item.sizeBytes)}
                        {item.width && item.height
                          ? ` | ${item.width}x${item.height}`
                          : ""}
                      </p>
                      <p className="block truncate text-[11px] text-slate-500">
                        {item.authors[0] || "Unknown"} |{" "}
                        {formatDate(item.updatedTime)}
                      </p>
                      <div className="sr-only">
                        Created: {formatDate(item.createdTime)}. Updated:{" "}
                        {formatDate(item.updatedTime)}.
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-8 text-center text-sm text-slate-600">
                No media found for the active filters.
              </div>
            )}
          </div>
        </div>
        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded border-2 border-dashed border-blue-500 bg-blue-50/80">
            <div className="text-sm font-medium text-blue-700">
              Drop files to upload
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
};

export default MediaGalleryOverlay;
