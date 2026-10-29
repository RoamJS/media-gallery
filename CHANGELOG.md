# Changelog

## 0.1.0 - Unreleased

### Added

- Media gallery command with search, filters, sorting, responsive previews, and source metadata.
- Opt-in local semantic search for images and GIFs using MobileCLIP in a web worker.
- Graph-scoped IndexedDB indexes with incremental content-hash updates and exact local similarity ranking.
- Semantic index progress, skipped-image reporting, source-block navigation, and current-graph clearing controls.
- File upload through the picker or drag and drop.
- URL and image clipboard actions with original-file download fallback.
- Source navigation for every referenced media card.
- Clickable multi-reference preview counts that open the actual referring blocks in Roam’s sidebar.
- Copy Markdown actions for image references, audio/video embeds, and file links.
- Semantic similarity percentages with an explicit 24-result display limit.
- Larger image, GIF, video, and audio previews, with original-file links for documents and unavailable previews.
- Semantic build and search cancellation, with index metadata and skipped-image reports under **Details**.

### Changed

- Refresh the gallery with a white dialog and compact Blueprint 3 controls inspired by Roam's advanced search.
- Label the filter control **Filters**, show its active count, and provide reset controls.
- Share author, media-type, orientation, and reference-block date filters between keyword and semantic search, applying them before the semantic result limit.
- Clarify that authors and dates come from referring blocks, rather than file uploads or original creators.
- Keep media actions visible below each card and close the gallery when opening a source block.
- Show the first-download notice beside **Build image index** in the setup view; the command-palette build still asks for confirmation.

### Fixed

- Use the model's full-precision image encoder for correct semantic rankings and rebuild older indexes instead of reusing incompatible image embeddings.
- Preserve uploaded file names in the block references created by the gallery.
- Capture the upload destination before the gallery takes focus and preserve it while files upload.
- Measure image orientation independently of visible thumbnails, retain known dimensions through refresh, and retry unavailable dimensions on refresh.
- Normalize Roam's Markdown-formatted upload response before creating a media reference.
- Retry the gallery query briefly when Roam's graph index lags behind a new upload.
- Recognize explicitly embedded images, video, and audio even when their URLs have no file extension.
- Keep the gallery layout compatible with Roam's global stylesheet.
- Keep expanded filters at a usable height and scroll the panel on narrow screens.
- Defer storage deletion to avoid leaving broken block references.
- Prevent a closed gallery from starting an image index build after an asynchronous summary read.
- Recover semantic search after a worker crash and bound temporary image memory during indexing.
- Prevent an in-flight build from recreating an index cleared in another tab.
- Keep clipboard/download results accurate and preserve original file bytes on fallback.
- Make main and pull-request workflows validation-only; publishing and Depot submissions remain separate.
