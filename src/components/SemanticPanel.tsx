import React, { useState } from "react";
import { Button, Callout, Icon, ProgressBar, Spinner } from "@blueprintjs/core";

import type {
  SemanticBuildReport,
  SemanticIndexSummary,
  SemanticProgress,
} from "~/types/semantic";

export type SemanticPanelProps = {
  graphName: string;
  summary: SemanticIndexSummary | null;
  summaryLoading: boolean;
  loading: boolean;
  operation: "building" | "searching" | "clearing" | null;
  progress: SemanticProgress | null;
  buildReport: SemanticBuildReport | null;
  error: string;
  indexStale?: boolean;
  onBuild: () => void;
  onCancel: () => void;
  onClear: () => void;
};

const formatStorageSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatUpdatedTime = (updatedAt: number | null): string =>
  updatedAt === null ? "Not built yet" : new Date(updatedAt).toLocaleString();

const getOperationLabel = (
  operation: SemanticPanelProps["operation"],
): string => {
  if (operation === "building") {
    return "Building image index";
  }
  if (operation === "searching") {
    return "Searching images";
  }
  return "Clearing image index";
};

const getProgressLabel = (progress: SemanticProgress | null): string => {
  if (progress?.message) {
    return progress.message;
  }
  const labels: Record<SemanticProgress["phase"], string> = {
    initializing: "Preparing the image search model…",
    hashing: "Checking images for changes…",
    embedding: "Processing images on this device…",
    saving: "Saving this graph's local index…",
    searching: "Finding images that match your description…",
  };
  return progress ? labels[progress.phase] : "Preparing…";
};

const getProgressValue = (
  progress: SemanticProgress | null,
): number | undefined => {
  if (!progress || progress.total <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, progress.completed / progress.total));
};

const SemanticPanel = ({
  graphName,
  summary,
  summaryLoading,
  loading,
  operation,
  progress,
  buildReport,
  error,
  indexStale = false,
  onBuild,
  onCancel,
  onClear,
}: SemanticPanelProps): React.ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const busy = operation !== null;
  const hasIndex = Boolean(summary?.exists);
  const skippedCount = buildReport?.skipped.length ?? 0;
  const progressValue = getProgressValue(progress);
  const finishing = operation === "building" && progress?.phase === "saving";
  const operationLabel = finishing
    ? "Finishing image index"
    : getOperationLabel(operation);
  const progressLabel = getProgressLabel(progress);
  const metrics = buildReport
    ? [
        ["Candidates", buildReport.candidateCount],
        ["Indexed", buildReport.indexedCount],
        ["Reused", buildReport.reusedCount],
        ["Embedded", buildReport.embeddedCount],
        ["Skipped", buildReport.skipped.length],
        ["Removed", buildReport.removedCount],
      ]
    : [];

  return (
    <section
      className="roamjs-media-gallery-semantic-panel"
      aria-label="Image search index"
    >
      {summaryLoading && !summary ? (
        <div className="roamjs-media-gallery-semantic-loading" role="status">
          <Spinner size={16} />
          <span>Checking this graph's image index…</span>
        </div>
      ) : null}

      {!summaryLoading && summary && !hasIndex && !busy ? (
        <div className="roamjs-media-gallery-semantic-setup">
          <Icon icon="search-around" iconSize={24} aria-hidden="true" />
          <div className="roamjs-media-gallery-semantic-setup-copy">
            <h3>Search images by description</h3>
            <p>
              Find images and GIFs with phrases like “sunset over water.” The
              first build downloads about 90 MB. Images are processed in your
              browser, and this graph's index stays in this browser profile.
            </p>
          </div>
          <Button
            text="Build image index"
            icon="build"
            intent="primary"
            minimal
            disabled={loading}
            onClick={onBuild}
          />
        </div>
      ) : null}

      {hasIndex && summary ? (
        <div className="roamjs-media-gallery-semantic-status-row">
          <div
            className="roamjs-media-gallery-semantic-ready"
            role="status"
            aria-live="polite"
          >
            <Icon icon="database" aria-hidden="true" />
            <span>
              {summary.itemCount} image{summary.itemCount === 1 ? "" : "s"}{" "}
              ready
            </span>
            {skippedCount > 0 ? <span>· {skippedCount} skipped</span> : null}
            {indexStale ? (
              <span className="roamjs-media-gallery-semantic-stale">
                Update needed
              </span>
            ) : null}
          </div>
          <div className="roamjs-media-gallery-semantic-index-actions">
            <Button
              small
              minimal
              text="Update index"
              icon="refresh"
              disabled={loading || busy}
              onClick={onBuild}
            />
            <Button
              small
              minimal
              text={
                skippedCount > 0
                  ? `Details · ${skippedCount} skipped`
                  : "Details"
              }
              rightIcon={detailsOpen ? "chevron-up" : "chevron-down"}
              aria-expanded={detailsOpen}
              aria-controls="roamjs-media-gallery-index-details"
              onClick={() => setDetailsOpen((open) => !open)}
            />
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="roamjs-media-gallery-semantic-progress">
          <div className="roamjs-media-gallery-semantic-progress-heading">
            <span role="status" aria-live="polite">
              {operationLabel}
            </span>
            {operation !== "clearing" ? (
              <Button
                small
                minimal
                text={finishing ? "Finishing…" : "Cancel"}
                disabled={finishing}
                onClick={onCancel}
              />
            ) : null}
          </div>
          <div className="roamjs-media-gallery-semantic-progress-label">
            <span>{progressLabel}</span>
            {progress && progress.total > 0 ? (
              <span>
                {Math.min(progress.total, Math.max(0, progress.completed))} /{" "}
                {progress.total}
              </span>
            ) : null}
          </div>
          <div
            role="progressbar"
            aria-label={operationLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              progressValue === undefined
                ? undefined
                : Math.round(progressValue * 100)
            }
            aria-valuetext={progressLabel}
          >
            <ProgressBar value={progressValue} />
          </div>
        </div>
      ) : null}

      {hasIndex && summary ? (
        <div
          id="roamjs-media-gallery-index-details"
          className="roamjs-media-gallery-semantic-details-body"
          hidden={!detailsOpen}
        >
          <dl className="roamjs-media-gallery-semantic-index-details">
            <div>
              <dt>Graph</dt>
              <dd>{graphName}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatUpdatedTime(summary.updatedAt)}</dd>
            </div>
            <div>
              <dt>Index size</dt>
              <dd>{formatStorageSize(summary.byteLength)}</dd>
            </div>
            {summary.model ? (
              <>
                <div>
                  <dt>Model</dt>
                  <dd>{summary.model.modelId}</dd>
                </div>
                <div>
                  <dt>Model revision</dt>
                  <dd>{summary.model.modelRevision}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {buildReport ? (
            <>
              <dl className="roamjs-media-gallery-semantic-report">
                {metrics.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="roamjs-media-gallery-semantic-storage-note">
                {buildReport.persistentStorage
                  ? "Browser storage is marked persistent."
                  : "This browser may remove the index when storage is low. You can rebuild it at any time."}
                {buildReport.modelChanged
                  ? " The index was rebuilt for the current model."
                  : ""}
              </p>
              {skippedCount > 0 ? (
                <div className="roamjs-media-gallery-semantic-skips">
                  <h4>Skipped images</h4>
                  <ul>
                    {buildReport.skipped.map((skip, index) => (
                      <li key={`${skip.mediaId}-${skip.stage}-${index}`}>
                        <strong>{skip.stage}</strong>: {skip.reason}
                        <span>{skip.url}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="roamjs-media-gallery-semantic-clear">
            <p>
              Stored only for this graph in this browser profile. Clearing the
              index does not delete your images or block references.
            </p>
            <Button
              small
              minimal
              text="Clear this graph's index"
              icon="trash"
              loading={operation === "clearing"}
              disabled={busy}
              onClick={onClear}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <Callout intent="danger" title="Image search needs attention">
          <span role="alert">{error}</span>
        </Callout>
      ) : null}
    </section>
  );
};

export default SemanticPanel;
