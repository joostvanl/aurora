"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentType, FlatEntry, Form, PackageImportResult } from "@cms/shared";
import { getBrowserAdminClient } from "@/lib/auth";

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Counters({
  label,
  value,
}: {
  label: string;
  value: { created: number; updated: number; skipped: number };
}) {
  return (
    <li>
      <strong>{label}:</strong> {value.created} created, {value.updated}{" "}
      updated, {value.skipped} skipped
    </li>
  );
}

function entryLabel(entry: FlatEntry): string {
  const title =
    typeof entry.fields.title === "string"
      ? entry.fields.title
      : typeof entry.fields.name === "string"
        ? entry.fields.name
        : typeof entry.fields.question === "string"
          ? entry.fields.question
          : null;
  return title && title !== entry.slug ? `${title} (${entry.slug})` : entry.slug;
}

export function PackagesManager() {
  const [types, setTypes] = useState<ContentType[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [entriesByType, setEntriesByType] = useState<
    Record<string, FlatEntry[]>
  >({});
  const [loadingEntries, setLoadingEntries] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedEntrySlugs, setSelectedEntrySlugs] = useState<
    Record<string, Set<string>>
  >({});
  const [selectedForms, setSelectedForms] = useState<Set<string>>(new Set());
  const [includeMedia, setIncludeMedia] = useState(true);
  const [importMode, setImportMode] = useState<"overwrite" | "skip">(
    "overwrite",
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingExport, setPendingExport] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);
  const [importResult, setImportResult] = useState<PackageImportResult | null>(
    null,
  );

  const loadEntriesForType = useCallback(async (apiId: string) => {
    setLoadingEntries((prev) => new Set(prev).add(apiId));
    try {
      const client = getBrowserAdminClient();
      const items: FlatEntry[] = [];
      let offset = 0;
      const pageSize = 100;
      for (;;) {
        const page = await client.listAdminEntries(apiId, {
          limit: pageSize,
          offset,
        });
        items.push(...page.items);
        offset += page.items.length;
        if (page.items.length < pageSize || offset >= page.total) break;
      }
      setEntriesByType((prev) => ({ ...prev, [apiId]: items }));
      return items;
    } finally {
      setLoadingEntries((prev) => {
        const next = new Set(prev);
        next.delete(apiId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const client = getBrowserAdminClient();
        const [cts, fs] = await Promise.all([
          client.listAdminContentTypes(),
          client.listForms(),
        ]);
        setTypes(cts);
        setForms(fs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, []);

  const selectedEntryCount = useMemo(() => {
    let n = 0;
    for (const slugs of Object.values(selectedEntrySlugs)) n += slugs.size;
    return n;
  }, [selectedEntrySlugs]);

  const canExport = useMemo(
    () =>
      selectedTypes.size > 0 ||
      selectedEntryCount > 0 ||
      selectedForms.size > 0,
    [selectedTypes, selectedEntryCount, selectedForms],
  );

  async function ensureTypeSelected(apiId: string, selectAllEntries: boolean) {
    let items = entriesByType[apiId];
    if (!items) {
      items = await loadEntriesForType(apiId);
    }
    setSelectedTypes((prev) => new Set(prev).add(apiId));
    if (selectAllEntries) {
      setSelectedEntrySlugs((prev) => ({
        ...prev,
        [apiId]: new Set(items.map((e) => e.slug)),
      }));
    }
  }

  async function toggleType(apiId: string) {
    if (selectedTypes.has(apiId)) {
      setSelectedTypes((prev) => {
        const next = new Set(prev);
        next.delete(apiId);
        return next;
      });
      setSelectedEntrySlugs((prev) => {
        const next = { ...prev };
        delete next[apiId];
        return next;
      });
      return;
    }
    try {
      await ensureTypeSelected(apiId, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entries");
    }
  }

  async function toggleEntry(apiId: string, slug: string) {
    try {
      if (!entriesByType[apiId]) {
        await loadEntriesForType(apiId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entries");
      return;
    }

    const current = new Set(selectedEntrySlugs[apiId] ?? []);
    if (current.has(slug)) current.delete(slug);
    else current.add(slug);

    setSelectedEntrySlugs((prev) => {
      const next = { ...prev };
      if (current.size === 0) delete next[apiId];
      else next[apiId] = current;
      return next;
    });
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (current.size === 0) next.delete(apiId);
      else next.add(apiId);
      return next;
    });
  }

  async function selectAllTypes() {
    setError(null);
    try {
      for (const t of types) {
        await ensureTypeSelected(t.apiId, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entries");
    }
  }

  function selectAllForms() {
    setSelectedForms(new Set(forms.map((f) => f.apiId)));
  }

  async function onExport() {
    if (!canExport) return;
    setPendingExport(true);
    setError(null);
    try {
      const contentTypeApiIds = [...selectedTypes];
      const entrySlugsByType: Record<string, string[]> = {};
      for (const apiId of contentTypeApiIds) {
        const slugs = selectedEntrySlugs[apiId];
        entrySlugsByType[apiId] = slugs ? [...slugs] : [];
      }

      const { blob, filename } = await getBrowserAdminClient().exportPackage({
        contentTypeApiIds,
        entrySlugsByType,
        formApiIds: [...selectedForms],
        includeMedia,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setPendingExport(false);
    }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) {
      setError("Choose a package ZIP to import");
      return;
    }
    setPendingImport(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await getBrowserAdminClient().importPackage(importFile, {
        mode: importMode,
        filename: importFile.name,
      });
      setImportResult(result);
      const client = getBrowserAdminClient();
      const [cts, fs] = await Promise.all([
        client.listAdminContentTypes(),
        client.listForms(),
      ]);
      setTypes(cts);
      setForms(fs);
      setEntriesByType({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setPendingImport(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {error && (
        <div className="panel" style={{ borderColor: "var(--danger, #c44)" }}>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Export package</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Select content types <em>and</em> the entries (pages) under them.
          Checking a type selects all its entries; you can uncheck individual
          pages. Forms and media can be included too.
        </p>

        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <strong>Content types &amp; entries</strong>
              <button
                type="button"
                className="btn"
                onClick={() => void selectAllTypes()}
                disabled={types.length === 0}
              >
                Select all
              </button>
            </div>
            {types.length === 0 ? (
              <p className="muted">No content types yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {types.map((t) => {
                  const entries = entriesByType[t.apiId];
                  const selected = selectedEntrySlugs[t.apiId] ?? new Set();
                  const typeChecked = selectedTypes.has(t.apiId);
                  return (
                    <li
                      key={t.apiId}
                      style={{
                        marginBottom: "0.75rem",
                        paddingBottom: "0.75rem",
                        borderBottom: "1px solid var(--border, #ddd)",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={typeChecked}
                          onChange={() => void toggleType(t.apiId)}
                        />
                        <span>
                          {t.name}{" "}
                          <span className="muted">
                            <code>{t.apiId}</code>
                          </span>
                          {entries ? (
                            <span className="muted">
                              {" "}
                              · {selected.size}/{entries.length} entries
                            </span>
                          ) : loadingEntries.has(t.apiId) ? (
                            <span className="muted"> · loading…</span>
                          ) : null}
                        </span>
                      </label>
                      {typeChecked && (
                        <ul
                          style={{
                            listStyle: "none",
                            padding: "0.4rem 0 0 1.5rem",
                            margin: 0,
                          }}
                        >
                          {loadingEntries.has(t.apiId) && !entries ? (
                            <li className="muted">Loading entries…</li>
                          ) : (entries ?? []).length === 0 ? (
                            <li className="muted">No entries in this type.</li>
                          ) : (
                            (entries ?? []).map((entry) => (
                              <li
                                key={entry.id}
                                style={{ marginBottom: "0.25rem" }}
                              >
                                <label
                                  style={{
                                    display: "flex",
                                    gap: "0.5rem",
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected.has(entry.slug)}
                                    onChange={() =>
                                      void toggleEntry(t.apiId, entry.slug)
                                    }
                                  />
                                  <span>
                                    {entryLabel(entry)}{" "}
                                    <span className="muted">
                                      {entry.status}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <strong>Forms</strong>
              <button
                type="button"
                className="btn"
                onClick={selectAllForms}
                disabled={forms.length === 0}
              >
                Select all
              </button>
            </div>
            {forms.length === 0 ? (
              <p className="muted">No forms yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {forms.map((f) => (
                  <li key={f.apiId} style={{ marginBottom: "0.35rem" }}>
                    <label
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedForms.has(f.apiId)}
                        onChange={() =>
                          setSelectedForms((s) => toggleInSet(s, f.apiId))
                        }
                      />
                      <span>
                        {f.name}{" "}
                        <span className="muted">
                          <code>{f.apiId}</code>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <label
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginTop: "1rem",
          }}
        >
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(e) => setIncludeMedia(e.target.checked)}
          />
          Include media files referenced by selected entries
        </label>

        <p className="muted" style={{ marginBottom: 0 }}>
          Selected: {selectedTypes.size} type(s), {selectedEntryCount}{" "}
          entr{selectedEntryCount === 1 ? "y" : "ies"}, {selectedForms.size}{" "}
          form(s)
        </p>

        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn primary"
            disabled={!canExport || pendingExport}
            onClick={() => void onExport()}
          >
            {pendingExport ? "Preparing…" : "Download package"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Import package</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload an Aurora package ZIP into this website. Content types,
          entries, forms, and media in the package are applied. Submissions,
          tokens, and website settings are not included.
        </p>

        <form className="form" onSubmit={(e) => void onImport(e)}>
          <div className="field">
            <label htmlFor="package-file">Package file</label>
            <input
              id="package-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <legend style={{ marginBottom: "0.35rem" }}>
              When items already exist
            </legend>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                marginBottom: "0.35rem",
              }}
            >
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "overwrite"}
                onChange={() => setImportMode("overwrite")}
              />
              Overwrite existing (update types, entries, forms)
            </label>
            <label
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "skip"}
                onChange={() => setImportMode("skip")}
              />
              Skip existing (only create missing items)
            </label>
          </fieldset>

          <button
            type="submit"
            className="btn primary"
            disabled={!importFile || pendingImport}
          >
            {pendingImport ? "Importing…" : "Import package"}
          </button>
        </form>

        {importResult && (
          <div style={{ marginTop: "1rem" }}>
            <h3 style={{ marginBottom: "0.5rem" }}>Import result</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Mode: <code>{importResult.mode}</code>
              {importResult.sourceSiteKey
                ? ` · from siteKey ${importResult.sourceSiteKey}`
                : null}
            </p>
            <ul style={{ margin: 0 }}>
              <Counters label="Content types" value={importResult.contentTypes} />
              <Counters label="Fields" value={importResult.fields} />
              <Counters label="Entries" value={importResult.entries} />
              <Counters label="Forms" value={importResult.forms} />
              <Counters label="Form fields" value={importResult.formFields} />
              <li>
                <strong>Media:</strong> {importResult.media.imported} imported,{" "}
                {importResult.media.skipped} skipped
              </li>
            </ul>
            {importResult.errors.length > 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <strong>Warnings</strong>
                <ul>
                  {importResult.errors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
