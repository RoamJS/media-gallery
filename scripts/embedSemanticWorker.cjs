const fs = require("node:fs");
const path = require("node:path");

const marker = "__MEDIA_GALLERY_INLINE_SEMANTIC_WORKER_SOURCE__";
const distDirectory = path.resolve(__dirname, "..", "dist");
const extensionPath = path.join(distDirectory, "extension.js");
const workerPath = path.join(distDirectory, "semantic.js");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
const workerSource = fs.readFileSync(workerPath, "utf8");
const markerLiteral = JSON.stringify(marker);
const markerCount = extensionSource.split(markerLiteral).length - 1;

if (markerCount !== 1) {
  throw new Error(
    `Expected one inline semantic worker marker in extension.js, found ${markerCount}.`,
  );
}

fs.writeFileSync(
  extensionPath,
  extensionSource.replace(markerLiteral, () => JSON.stringify(workerSource)),
);
