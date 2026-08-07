"use client";

import type { ContentType, FlatEntry, WebsiteDetails } from "@cms/shared";
import { flagEmoji } from "@cms/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { getStoredUser } from "@/lib/auth";
import {
  type ColumnDef,
  type ColumnId,
  availableColumns,
  defaultColumnIds,
  fieldApiIdFromColumn,
  isFieldColumnId,
  loadColumnPrefs,
  saveColumnPrefs,
} from "@/lib/entriesColumns";

function cellSearchText(entry: FlatEntry, col: ColumnDef): string {
  if (col.kind === "builtin") {
    switch (col.id) {
      case "slug":
        return entry.slug;
      case "locale":
        return entry.locale;
      case "status":
        return entry.status;
      case "updatedAt":
        return entry.updatedAt;
      case "createdAt":
        return entry.createdAt;
      case "publishedAt":
        return entry.publishedAt ?? "";
      default:
        return "";
    }
  }
  if (!isFieldColumnId(col.id)) return "";
  return fieldValueToSearch(entry.fields[fieldApiIdFromColumn(col.id)]);
}

function fieldValueToSearch(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value && "url" in value) {
    const media = value as { url?: unknown; alt?: unknown };
    return [media.url, media.alt].filter((v) => typeof v === "string").join(" ");
  }
  if (Array.isArray(value)) {
    return value.map(fieldValueToSearch).join(" ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function formatFieldCell(value: unknown, fieldType?: string): ReactNode {
  if (value == null || value === "") {
    return <span className="muted">—</span>;
  }
  if (fieldType === "boolean") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (fieldType === "datetime" && typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
  if (fieldType === "media") {
    const url =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "url" in value
          ? String((value as { url: unknown }).url ?? "")
          : "";
    if (!url) return <span className="muted">—</span>;
    return (
      <span className="entries-media-cell">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" referrerPolicy="no-referrer" />
      </span>
    );
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed.length > 80) return `${trimmed.slice(0, 77)}…`;
    return trimmed || <span className="muted">—</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return <span className="muted">…</span>;
}

function renderCell(entry: FlatEntry, col: ColumnDef): ReactNode {
  if (col.kind === "field" && isFieldColumnId(col.id)) {
    return formatFieldCell(
      entry.fields[fieldApiIdFromColumn(col.id)],
      col.fieldType,
    );
  }
  switch (col.id) {
    case "slug":
      return <code>{entry.slug}</code>;
    case "locale":
      return (
        <span title={entry.locale}>
          {flagEmoji(entry.locale)} <code>{entry.locale}</code>
        </span>
      );
    case "status":
      return (
        <span className="badge" data-status={entry.status}>
          {entry.status}
        </span>
      );
    case "updatedAt":
      return (
        <span className="muted">
          {new Date(entry.updatedAt).toLocaleString()}
        </span>
      );
    case "createdAt":
      return (
        <span className="muted">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      );
    case "publishedAt":
      return (
        <span className="muted">
          {entry.publishedAt
            ? new Date(entry.publishedAt).toLocaleString()
            : "—"}
        </span>
      );
    default:
      return null;
  }
}

function compareEntries(
  a: FlatEntry,
  b: FlatEntry,
  sort: ColumnId,
  order: "asc" | "desc",
  columns: ColumnDef[],
): number {
  const col = columns.find((c) => c.id === sort);
  const dir = order === "asc" ? 1 : -1;

  const get = (entry: FlatEntry): string | number => {
    if (!col || col.kind === "builtin") {
      switch (sort) {
        case "slug":
          return entry.slug.toLowerCase();
        case "locale":
          return entry.locale.toLowerCase();
        case "status":
          return entry.status;
        case "updatedAt":
          return new Date(entry.updatedAt).getTime();
        case "createdAt":
          return new Date(entry.createdAt).getTime();
        case "publishedAt":
          return entry.publishedAt
            ? new Date(entry.publishedAt).getTime()
            : 0;
        default:
          return "";
      }
    }
    if (isFieldColumnId(sort)) {
      const raw = entry.fields[fieldApiIdFromColumn(sort)];
      if (typeof raw === "number") return raw;
      if (typeof raw === "boolean") return raw ? 1 : 0;
      if (typeof raw === "string") {
        if (col.fieldType === "datetime") {
          const t = new Date(raw).getTime();
          return Number.isNaN(t) ? raw.toLowerCase() : t;
        }
        return raw.toLowerCase();
      }
      return fieldValueToSearch(raw).toLowerCase();
    }
    return "";
  };

  const av = get(a);
  const bv = get(b);
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return a.slug.localeCompare(b.slug) || a.locale.localeCompare(b.locale);
}

export function EntriesList({
  apiId,
  type,
  website,
  initialItems,
  initialTotal,
  initialLocale,
}: {
  apiId: string;
  type: ContentType;
  website: WebsiteDetails;
  initialItems: FlatEntry[];
  initialTotal: number;
  initialLocale?: string;
}) {
  const router = useRouter();
  const columnsPanelId = useId();
  const allColumns = useMemo(() => availableColumns(type), [type]);
  const [userId, setUserId] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() =>
    defaultColumnIds(type),
  );
  const [prefsReady, setPrefsReady] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">(
    "all",
  );
  const [localeFilter, setLocaleFilter] = useState(initialLocale ?? "all");
  const [sort, setSort] = useState<ColumnId>("updatedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const user = getStoredUser();
    const uid = user?.id ?? "anonymous";
    setUserId(uid);
    const saved = loadColumnPrefs(uid, website.id, apiId, allColumns);
    if (saved) setVisibleColumns(saved);
    setPrefsReady(true);
  }, [apiId, website.id, allColumns]);

  useEffect(() => {
    if (!prefsReady || !userId) return;
    saveColumnPrefs(userId, website.id, apiId, visibleColumns);
  }, [prefsReady, userId, website.id, apiId, visibleColumns]);

  const activeColumns = useMemo(() => {
    const byId = new Map(allColumns.map((c) => [c.id, c]));
    return visibleColumns
      .map((id) => byId.get(id))
      .filter((c): c is ColumnDef => Boolean(c));
  }, [allColumns, visibleColumns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = initialItems;
    if (statusFilter !== "all") {
      rows = rows.filter((e) => e.status === statusFilter);
    }
    if (localeFilter !== "all") {
      rows = rows.filter((e) => e.locale === localeFilter);
    }
    if (q) {
      rows = rows.filter((entry) => {
        if (entry.slug.toLowerCase().includes(q)) return true;
        if (entry.locale.toLowerCase().includes(q)) return true;
        if (entry.status.toLowerCase().includes(q)) return true;
        for (const col of allColumns) {
          if (cellSearchText(entry, col).toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    return [...rows].sort((a, b) =>
      compareEntries(a, b, sort, order, allColumns),
    );
  }, [
    initialItems,
    statusFilter,
    localeFilter,
    query,
    sort,
    order,
    allColumns,
  ]);

  function toggleSort(columnId: ColumnId) {
    const col = allColumns.find((c) => c.id === columnId);
    if (!col?.sortable) return;
    if (sort === columnId) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(columnId);
      setOrder(
        columnId === "slug" || columnId === "locale" || columnId === "status"
          ? "asc"
          : "desc",
      );
    }
  }

  function toggleColumn(id: ColumnId) {
    setVisibleColumns((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== id);
      }
      return [...prev, id];
    });
  }

  function openEntry(entryId: string) {
    router.push(`/entries/${apiId}/${entryId}`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{type.name} entries</h1>
          <p>
            Draft and publish content for the public API.
            {type.localizationMode === "all_locales"
              ? " Mode: all site languages."
              : " Mode: explicit languages."}
          </p>
        </div>
        <Link className="btn" href={`/entries/${apiId}/new`}>
          New entry
        </Link>
      </div>

      <div className="entries-toolbar">
        <label className="entries-search">
          <span className="sr-only">Search entries</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slug, locale, fields…"
          />
        </label>

        <label className="entries-filter">
          <span className="muted">Status</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | "draft" | "published")
            }
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>

        <label className="entries-filter">
          <span className="muted">Locale</span>
          <select
            value={localeFilter}
            onChange={(e) => setLocaleFilter(e.target.value)}
          >
            <option value="all">All locales</option>
            {website.locales.map((code) => (
              <option key={code} value={code}>
                {flagEmoji(code)} {code}
              </option>
            ))}
          </select>
        </label>

        <div className="entries-columns">
          <button
            type="button"
            className="btn btn-secondary"
            aria-expanded={columnsOpen}
            aria-controls={columnsPanelId}
            onClick={() => setColumnsOpen((o) => !o)}
          >
            Columns
          </button>
          {columnsOpen ? (
            <div
              id={columnsPanelId}
              className="entries-columns-panel"
              role="group"
              aria-label="Visible columns"
            >
              {allColumns.map((col) => (
                <label key={col.id} className="entries-columns-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span>{col.label}</span>
                  {col.kind === "field" ? (
                    <span className="muted">{col.fieldType}</span>
                  ) : null}
                </label>
              ))}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setVisibleColumns(defaultColumnIds(type))}
              >
                Reset defaults
              </button>
            </div>
          ) : null}
        </div>

        <p className="muted entries-count">
          {filtered.length === initialItems.length
            ? `${filtered.length} of ${initialTotal}`
            : `${filtered.length} shown · ${initialTotal} total`}
          {initialTotal > initialItems.length
            ? ` (loaded ${initialItems.length})`
            : null}
        </p>
      </div>

      <div className="panel">
        <table className="table entries-table">
          <thead>
            <tr>
              {activeColumns.map((col) => (
                <th key={col.id} scope="col">
                  {col.sortable ? (
                    <button
                      type="button"
                      className="entries-sort"
                      data-active={sort === col.id ? "true" : "false"}
                      onClick={() => toggleSort(col.id)}
                    >
                      {col.label}
                      {sort === col.id ? (
                        <span aria-hidden="true">
                          {order === "asc" ? " ↑" : " ↓"}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr
                key={entry.id}
                className="entries-row"
                tabIndex={0}
                role="link"
                aria-label={`Edit ${entry.slug} (${entry.locale})`}
                onClick={() => openEntry(entry.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEntry(entry.id);
                  }
                }}
              >
                {activeColumns.map((col) => (
                  <td key={col.id}>{renderCell(entry, col)}</td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(activeColumns.length, 1)}
                  className="empty"
                >
                  {initialItems.length === 0
                    ? "No entries yet."
                    : "No entries match your search or filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
