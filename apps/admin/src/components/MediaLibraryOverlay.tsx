"use client";

import type { MediaLibraryItem } from "@cms/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

const PAGE_SIZE = 48;

export function MediaLibraryOverlay({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MediaLibraryItem) => void;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { skip: number; q: string; append: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getBrowserAdminClient().listMediaLibrary({
          skip: opts.skip,
          limit: PAGE_SIZE,
          q: opts.q || undefined,
        });
        setItems((prev) =>
          opts.append ? [...prev, ...res.items] : res.items,
        );
        setSkip(res.skip);
        setHasMore(res.hasMore);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load ImageKit library",
        );
        if (!opts.append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSubmittedQuery("");
    setItems([]);
    setSkip(0);
    setHasMore(false);
    void load({ skip: 0, q: "", append: false });
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="media-library-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="media-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="media-library-header">
          <div>
            <h2 id={titleId}>Media library</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0" }}>
              Images from the ImageKit folder configured in Media settings.
              Click one to use it.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form
          className="media-library-search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            setSubmittedQuery(q);
            void load({ skip: 0, q, append: false });
          }}
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by filename…"
            aria-label="Search ImageKit images"
          />
          <button className="btn" type="submit" disabled={loading}>
            Search
          </button>
        </form>

        {error ? (
          <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
        ) : null}

        <div className="media-library-grid" aria-busy={loading}>
          {items.map((item) => (
            <button
              key={item.fileId}
              type="button"
              className="media-library-tile"
              title={item.name}
              onClick={() => {
                onSelect(item);
                onClose();
              }}
            >
              <span className="media-library-thumb">
                <img
                  src={item.thumbnailUrl || item.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </span>
              <span className="media-library-name">{item.name}</span>
            </button>
          ))}
          {!loading && items.length === 0 ? (
            <p className="muted media-library-empty">
              {submittedQuery
                ? "No images matched that search."
                : "No images found in this ImageKit folder."}
            </p>
          ) : null}
        </div>

        <div className="media-library-footer">
          {loading ? <span className="muted">Loading…</span> : null}
          {!loading && hasMore ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void load({
                  skip: skip + PAGE_SIZE,
                  q: submittedQuery,
                  append: true,
                })
              }
            >
              Load more
            </button>
          ) : null}
          {!loading && items.length > 0 ? (
            <span className="muted">
              Showing {items.length}
              {hasMore ? "+" : ""} image{items.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
