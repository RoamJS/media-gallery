import React from "react";
import { HTMLSelect } from "@blueprintjs/core";
import type { MediaFilters } from "~/types/media";
import { getDateRangeError } from "~/utils/media/presentation";

type Props = {
  filters: MediaFilters;
  authors: string[];
  semantic: boolean;
  updateFilter: <K extends keyof MediaFilters>(
    key: K,
    value: MediaFilters[K],
  ) => void;
};
const MediaFilterFields = ({
  filters,
  authors,
  semantic,
  updateFilter,
}: Props): React.ReactElement => {
  const error = getDateRangeError(filters);
  return (
    <>
      <div className="roamjs-media-gallery-filter-grid">
        <label>
          Block contributor
          <HTMLSelect
            aria-label="Block contributor"
            value={filters.author}
            onChange={(event) => updateFilter("author", event.target.value)}
          >
            <option value="all">All contributors</option>
            {authors.map((author, index) => (
              <option key={author} value={author}>
                {/^[a-z0-9_-]{20,}$/i.test(author)
                  ? `Unknown contributor ${index + 1}`
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
            {["image", "gif", "video", "audio", "pdf", "document", "other"].map(
              (type) => (
                <option key={type} value={type}>
                  {type === "gif" || type === "pdf"
                    ? type.toUpperCase()
                    : type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ),
            )}
          </HTMLSelect>
        </label>
        <label>
          Image orientation
          <HTMLSelect
            aria-label="Image orientation"
            value={filters.orientation}
            onChange={(event) =>
              updateFilter(
                "orientation",
                event.target.value as MediaFilters["orientation"],
              )
            }
          >
            <option value="all">All orientations</option>
            {["landscape", "portrait", "square", "unknown"].map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </HTMLSelect>
        </label>
      </div>
      <div className="roamjs-media-gallery-date-grid">
        {(
          [
            ["createdFrom", "Earliest block created from"],
            ["createdTo", "Earliest block created to"],
            ["updatedFrom", "Latest block edited from"],
            ["updatedTo", "Latest block edited to"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="date"
              aria-label={label}
              className="bp3-input"
              value={filters[key]}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "media-gallery-date-error" : undefined}
              min={
                key === "createdTo"
                  ? filters.createdFrom
                  : key === "updatedTo"
                    ? filters.updatedFrom
                    : undefined
              }
              max={
                key === "createdFrom"
                  ? filters.createdTo
                  : key === "updatedFrom"
                    ? filters.updatedTo
                    : undefined
              }
              onChange={(event) => updateFilter(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      {error ? (
        <p
          id="media-gallery-date-error"
          className="roamjs-media-gallery-inline-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <p className="roamjs-media-gallery-filter-note">
        Dates and contributors describe referring Roam blocks, not file uploads
        or ownership.
        {semantic
          ? " Filters apply to all indexed images; results stay ordered by similarity."
          : ""}
      </p>
    </>
  );
};
export default MediaFilterFields;
