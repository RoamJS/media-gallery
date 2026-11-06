# Media Gallery

<a href="https://roamjs.com/">
    <img src="https://avatars.githubusercontent.com/u/138642184" alt="RoamJS Logo" title="RoamJS" align="right" height="60" />
</a>

**Find media across your graph in one gallery. Search by name or visual meaning, preview files, and jump straight to their source blocks.**

[![RoamJS](https://roamjs.com/badges/website.svg)](https://roamjs.com/) [![DeepWiki](https://roamjs.com/badges/deepwiki.svg)](https://deepwiki.com/RoamJS/media-gallery) [![Slack](https://roamjs.com/badges/slack.svg)](https://roamresearch.slack.com/archives/C016N2B66JU)

[![Watch the 35-second Media Gallery promo: a gallery of the car, sunflower, cat, and dog demo photographs](https://github.com/user-attachments/assets/b622037d-5af6-4c0c-92f2-6a6adf682ca8)](https://github.com/user-attachments/assets/a9a15866-0bc8-4982-999e-897ef3d5266f)

[Photo credits](docs/media/promo-photo-credits.md)

## Features

- Browse images, GIFs, videos, audio, PDFs, and other files.
- Search filenames, URLs, labels, and block authors, or find images by visual meaning.
- Filter by contributor, type, orientation, and reference date.
- Open larger previews and jump to any referring block.
- Copy URLs, images, or embeds, and download original files.
- Upload files with the picker or drag and drop.

## How to use it

Open the command palette and choose **Open Media Gallery**. Search, choose **Filters** to narrow results, or select a thumbnail for a larger preview. **Source** opens the referring block. **More** contains copy and download actions; preview reference details expand under **Used in … blocks**.

For visual search, choose **Semantic**, then **Build image index**. The first build downloads a model (about 90 MB); image analysis and searches run locally. Choose **Update index** after adding images. Visual search covers images and GIFs, not exact text inside them.

Check **Add to…** before uploading. **Details** shows file progress, and **Retry failed files** reuses files already uploaded if only reference creation failed. Successful batches can be dismissed.

Uploads go beneath the block focused when you opened the gallery, to the open page, or to **Media Gallery Uploads** if neither is available.

Dates and authors describe referencing blocks, not file uploads or photographers. File deletion is unavailable; use **Source** to manage references.
