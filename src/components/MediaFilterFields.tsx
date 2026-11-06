import React, { useEffect, useState } from "react";
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
  const hasDates = Boolean(
    filters.createdFrom ||
    filters.createdTo ||
    filters.updatedFrom ||
    filters.updatedTo,
  );
  const [datesOpen, setDatesOpen] = useState(hasDates);
  useEffect(() => {
    if (hasDates || error) setDatesOpen(true);
  }, [hasDates, error]);
  return (
    <>
      <div className="roamjs-media-gallery-filter-grid">
        <label>
          Contributor
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
          Type
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
          Orientation
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
      <details className="roamjs-media-gallery-date-section" open={datesOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setDatesOpen((open) => !open);
          }}
        >
          Date range{hasDates ? " · Active" : ""}
        </summary>
        <p className="roamjs-media-gallery-filter-note">
          Dates refer to Roam blocks.
        </p>
        {(
          [
            ["created", "First block created"],
            ["updated", "Last block edited"],
          ] as const
        ).map(([kind, heading]) => (
          <fieldset key={kind} className="roamjs-media-gallery-date-group">
            <legend>{heading}</legend>
            <div className="roamjs-media-gallery-date-grid">
              {(["From", "To"] as const).map((bound) => {
                const key = `${kind}${bound}` as
                  | "createdFrom"
                  | "createdTo"
                  | "updatedFrom"
                  | "updatedTo";
                const label = `${heading} ${bound.toLowerCase()}`;
                return (
                  <label key={key}>
                    {bound}
                    <input
                      type="date"
                      aria-label={label}
                      className="bp3-input"
                      value={filters[key]}
                      aria-invalid={Boolean(error)}
                      aria-describedby={
                        error ? "media-gallery-date-error" : undefined
                      }
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
                      onChange={(event) =>
                        updateFilter(key, event.target.value)
                      }
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        {error ? (
          <p
            id="media-gallery-date-error"
            className="roamjs-media-gallery-inline-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </details>
      {semantic ? (
        <p className="roamjs-media-gallery-filter-note">
          Results stay ordered by similarity.
        </p>
      ) : null}
    </>
  );
};
export default MediaFilterFields;
