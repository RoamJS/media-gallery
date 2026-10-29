# Media Gallery

<a href="https://roamjs.com/">
    <img src="https://avatars.githubusercontent.com/u/138642184" alt="RoamJS Logo" title="RoamJS" align="right" height="60" />
</a>

**Find the images, GIFs, videos, audio, PDFs, and files scattered across your graph, then search, filter, copy, upload, or manage them from one gallery.**

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/RoamJS/media-gallery)

## Features

- Browse media referenced anywhere in your graph in a responsive gallery.
- Search by file name, URL, Markdown label, or Roam block author.
- Build an optional local image index and search images and GIFs by visual meaning.
- Filter by block author, media type, orientation, and reference-block created or updated date.
- Sort keyword results by reference-block created or updated time in either direction.
- Upload one or more files from the picker or by dragging them into the gallery.
- Copy media URLs and supported images, with original-file downloads for other formats or blocked clipboard access.
- Open a larger image, GIF, video, or audio preview from any thumbnail.
- Jump from any media card to the block that references it.
- Open every referring block in the sidebar from a multi-reference preview count.
- Copy Markdown references and Roam audio/video embeds from the preview.

## How to use it

1. Open the command palette and choose **Open Media Gallery**.
2. Search immediately, or choose **Filters** for author, type, orientation, date, and sorting options. Active filters are counted on the button; **Reset** clears the search and filters.
3. Select a thumbnail to open a larger preview. **Source**, **Copy URL**, **Copy image** (for supported images), and **Download** remain visible below each card. Documents and unavailable previews offer **Open original** in the preview dialog.
4. Choose **Source** to close the gallery and open the referencing block in Roam.
5. Choose **Upload** or drag files anywhere in the dialog. The gallery remembers the focused block or open page when you open it, so changing focus while uploading does not change the destination. If no destination was available, references go to a **Media Gallery Uploads** page.

The gallery uses a white dialog and compact Blueprint 3 controls that follow Roam's search interface. It reads media references from block text and combines duplicate URLs into one item. Created and updated details come from the blocks that reference each item. The earliest block creation and latest block edit are shown; neither establishes when the file was uploaded or when its URL was inserted. In a preview, click a count of multiple references to open those exact referring blocks in Roam’s right sidebar. **Copy Markdown** copies an image reference, Roam audio/video embed, or file link with the filename.

**Block author** comes from Roam's creator and last-editor metadata on every block that references the media URL. Names are read from the linked Roam user/profile page, with a user-ID fallback when a name is unavailable. This describes who created or edited the Roam reference, not the photographer or original file creator. Photo credits stored in other blocks or inside the image are separate from this filter.

Choosing an orientation checks image and GIF dimensions even when their thumbnails are outside the visible results. The gallery shows progress while checking and keeps known dimensions when you choose **Refresh**. If an image cannot be measured, **Refresh** retries it; its orientation remains **Unknown** until dimensions are available.

### Local semantic image search

1. Open **Media Gallery: Semantic Image Search**, or choose **Semantic** in the gallery. Read the setup notice, then select **Build image index**. The first build downloads the MobileCLIP model (about 90 MB), which is cached by your browser.
2. Alternatively, choose **Media Gallery: Build Image Index** from the command palette and confirm the download and build notice. Use **Cancel** to stop a running build or search.
3. Enter a phrase such as `handwritten diagram`, `sunset over water`, or `green dashboard`, then press Enter or choose **Search**.
4. Use the compact index footer to choose **Update index** after adding or changing images. Unchanged image vectors are reused, and removed images are dropped. Open **Details** in the footer for index metadata, the latest build report, skipped images, and the control to clear this graph's index.

Semantic search ranks up to 24 images by visual similarity, closest first. **Filters** works in both modes: block author, media type, orientation, and reference-block dates apply to the full ranked image index before the 24-result display limit. Changing filters updates existing results immediately, preserving similarity order; keyword text and keyword date sorting do not affect semantic results. Semantic search covers images and GIFs, so choosing another media type returns no results. When the limit is reached, the header shows **Top 24 of N indexed images** and the maximum is stated above and below the results. It does not apply a minimum similarity cutoff, so a small index can return every image even for a specific description. The results are suggestions and may include weak similarities. Use **Keyword** for exact terms in filenames, URLs, Markdown labels, or block authors.

Each semantic thumbnail shows its cosine similarity as a percentage, for example **4.8% similarity**. The scale runs from −100% to 100%; this is the raw similarity multiplied by 100, not a probability or match confidence.

Older image indexes show **Update needed** after the model configuration changes. Choose **Update index** to rebuild their image data; incompatible vectors are replaced even when the image files have not changed.

For encrypted Roam graphs, hosted files are retrieved through Roam’s file API before previewing, measuring dimensions, or sending decrypted image bytes to the local worker. Decrypted preview URLs are temporary and released when no longer needed.

The index is opt-in and scoped to the current graph. Image fingerprints, metadata, and normalized vectors are stored locally in IndexedDB; they are not written into your graph. You can clear the current graph's index from the semantic search view or the extension settings. Opening the ordinary gallery does not load the model. Model assets come from Hugging Face and the inference runtime’s CDN; search descriptions and image embeddings are processed locally, with no remote inference service. Indexing fetches eligible images from their existing hosts.

## Current limitations

- Opening the gallery scans media references across the graph. Very large graphs may take longer to load.
- Semantic search covers images and GIFs. It matches visual concepts; it is not OCR and will not reliably find exact text inside an image.
- The browser must be allowed to fetch and decode an image before it can be indexed. Hosts that block cross-origin access are reported and skipped.
- The first index build can take a while because the model must download and each eligible image must be processed locally. WebGPU is used when available, with a single-threaded WebAssembly fallback.
- Storage deletion is deferred in v0.1 to avoid leaving broken block references. Use **Source** to manage the reference in your graph.
- PNG images copy directly; JPEG and BMP images are converted to PNG for the clipboard. Other formats download unchanged, preserving animation and file contents.
- File size is shown after a copy/download action fetches the file.
