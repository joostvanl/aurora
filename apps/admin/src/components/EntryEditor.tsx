"use client";

import type { ContentType, FieldDefinition, FlatEntry, MediaLibraryItem, WebsiteDetails } from "@cms/shared";
import { flagEmoji } from "@cms/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";
import { EntryAiShortcuts } from "@/components/EntryAiShortcuts";
import {
  onAiEntryUpdated,
  onAiStudioMutated,
  useAiScreen,
} from "@/components/AiScreenContext";
import { EntryVersions } from "@/components/EntryVersions";
import { MediaLibraryOverlay } from "@/components/MediaLibraryOverlay";
import { RichTextEditor } from "@/components/RichTextEditor";
function fieldDefault(type: FieldDefinition["type"]): unknown {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "relations":
      return [];
    case "relation":
      return "";
    default:
      return "";
  }
}

function valuesFromEntry(
  fields: FieldDefinition[],
  entry?: FlatEntry,
): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const f of fields) {
    initial[f.apiId] = entry?.fields[f.apiId] ?? fieldDefault(f.type);
  }
  return initial;
}

function isSlugField(field: FieldDefinition): boolean {
  return field.apiId === "slug" || field.type === "slug";
}

function fieldsInOrder(contentType: ContentType): FieldDefinition[] {
  return [...(contentType.fields ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

export function EntryEditor({
  contentType,
  entry,
}: {
  contentType: ContentType;
  entry?: FlatEntry;
}) {
  const router = useRouter();
  const { setHints } = useAiScreen();
  const [schema, setSchema] = useState(contentType);
  const fields = useMemo(() => fieldsInOrder(schema), [schema]);
  const [current, setCurrent] = useState<FlatEntry | undefined>(entry);
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [locale, setLocale] = useState(entry?.locale ?? "");
  const [website, setWebsite] = useState<WebsiteDetails | null>(null);
  const [siblings, setSiblings] = useState<FlatEntry[]>([]);
  const [addLocale, setAddLocale] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    valuesFromEntry(fieldsInOrder(contentType), entry),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);

  useEffect(() => {
    setSchema(contentType);
  }, [contentType]);

  // Keep field order in sync after content-type reorders (client navigate / soft cache).
  useEffect(() => {
    getBrowserAdminClient()
      .getContentType(contentType.apiId)
      .then(setSchema)
      .catch(() => {
        /* keep server-provided schema */
      });
  }, [contentType.apiId]);

  useEffect(() => {
    getBrowserAdminClient()
      .getWebsite()
      .then((w) => {
        setWebsite(w);
        if (!entry?.locale) setLocale(w.defaultLocale);
      })
      .catch(() => {});
  }, [entry?.locale]);

  useEffect(() => {
    setCurrent(entry);
    setSlug(entry?.slug ?? "");
    if (entry?.locale) setLocale(entry.locale);
    setValues(valuesFromEntry(fieldsInOrder(contentType), entry));
  }, [entry, contentType]);

  useEffect(() => {
    if (!current?.slug) {
      setSiblings([]);
      return;
    }
    getBrowserAdminClient()
      .listAdminEntries(contentType.apiId, { slug: current.slug, limit: 50 })
      .then((res) => setSiblings(res.items))
      .catch(() => setSiblings([]));
  }, [current?.slug, current?.id, contentType.apiId]);

  useEffect(() => {
    setHints({
      page: current
        ? `Entry editor · ${current.slug} · ${current.locale}`
        : `New ${schema.name}`,
      contentTypeApiId: schema.apiId,
      entryId: current?.id,
    });
    return () => setHints(null);
  }, [setHints, schema.apiId, schema.name, current?.id, current?.slug, current?.locale]);

  useEffect(() => {
    return onAiEntryUpdated((detail) => {
      if (current?.id && detail.entry.id === current.id) {
        applyEntry(detail.entry);
      }
    });
  }, [current?.id, fields]);

  useEffect(() => {
    return onAiStudioMutated(() => {
      const client = getBrowserAdminClient();
      void client.getContentType(contentType.apiId).then(setSchema).catch(() => {});
      const entryId = current?.id;
      if (!entryId) return;
      client
        .getAdminEntry(contentType.apiId, entryId)
        .then((fresh) => {
          setCurrent(fresh);
          setSlug(fresh.slug);
          setLocale(fresh.locale);
          setValues(valuesFromEntry(fields, fresh));
          setVersionsKey((k) => k + 1);
        })
        .catch(() => {
          /* keep current editor state */
        });
    });
  }, [current?.id, contentType.apiId, fields]);

  function applyEntry(next: FlatEntry) {
    setCurrent(next);
    setSlug(next.slug);
    setLocale(next.locale);
    setValues(valuesFromEntry(fields, next));
    setVersionsKey((k) => k + 1);
  }

  const title = useMemo(
    () =>
      current
        ? `Edit ${current.slug} (${flagEmoji(current.locale)} ${current.locale})`
        : `New ${schema.name}`,
    [current, schema.name],
  );

  const hasSlugInSchema = fields.some(isSlugField);

  const missingLocales = useMemo(() => {
    if (!website) return [];
    const present = new Set(siblings.map((s) => s.locale));
    return website.locales.filter((l) => !present.has(l));
  }, [website, siblings]);

  function setField(apiId: string, value: unknown) {
    setValues((prev) => ({ ...prev, [apiId]: value }));
  }

  async function save(asPublish = false) {
    setPending(true);
    setError(null);
    const client = getBrowserAdminClient();
    try {
      const payload = {
        slug,
        fields: values,
        status: asPublish ? ("published" as const) : undefined,
      };

      let saved: FlatEntry;
      if (current) {
        saved = await client.updateEntry(contentType.apiId, current.id, payload);
        if (asPublish && saved.status !== "published") {
          saved = await client.publishEntry(contentType.apiId, current.id);
        }
      } else {
        saved = await client.createEntry(contentType.apiId, {
          slug,
          locale: locale || undefined,
          fields: values,
          status: asPublish ? "published" : "draft",
        });
      }

      applyEntry(saved);
      router.push(`/entries/${contentType.apiId}/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function addTranslation() {
    if (!current || !addLocale) return;
    setPending(true);
    setError(null);
    try {
      const created = await getBrowserAdminClient().createTranslation(
        contentType.apiId,
        current.id,
        { locale: addLocale },
      );
      router.push(`/entries/${contentType.apiId}/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add translation");
    } finally {
      setPending(false);
    }
  }

  async function unpublish() {
    if (!current) return;
    setPending(true);
    try {
      const saved = await getBrowserAdminClient().unpublishEntry(
        contentType.apiId,
        current.id,
      );
      applyEntry(saved);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpublish failed");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!current) return;
    if (!confirm("Delete this entry?")) return;
    await getBrowserAdminClient().deleteEntry(contentType.apiId, current.id);
    router.push(`/entries/${contentType.apiId}`);
    router.refresh();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>
            {current ? (
              <>
                Status{" "}
                <span className="badge" data-status={current.status}>
                  {current.status}
                </span>
              </>
            ) : (
              "Create a draft or publish immediately."
            )}
          </p>
        </div>
      </div>

      <EntryAiShortcuts
        entryId={current?.id}
        hasContent={Object.values(values).some(
          (v) => typeof v === "string" && v.trim().length > 0,
        )}
      />

      {current ? (
        <div className="actions" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
          {siblings.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`btn btn-secondary${s.id === current.id ? "" : ""}`}
              style={
                s.id === current.id
                  ? { outline: "2px solid var(--accent, #2bb8b0)" }
                  : undefined
              }
              onClick={() => {
                if (s.id !== current.id) {
                  router.push(`/entries/${contentType.apiId}/${s.id}`);
                }
              }}
            >
              {flagEmoji(s.locale)} {s.locale}
              <span className="muted" style={{ marginLeft: "0.35rem" }}>
                {s.status}
              </span>
            </button>
          ))}
          {missingLocales.length > 0 && (
            <>
              <select
                value={addLocale}
                onChange={(e) => setAddLocale(e.target.value)}
                disabled={pending}
              >
                <option value="">Add translation…</option>
                {missingLocales.map((code) => (
                  <option key={code} value={code}>
                    {flagEmoji(code)} {code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending || !addLocale}
                onClick={() => void addTranslation()}
              >
                Add translation
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="panel">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          {!current && website && (
            <div className="field">
              <label htmlFor="locale">Locale</label>
              <select
                id="locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                required
              >
                {website.locales.map((code) => (
                  <option key={code} value={code}>
                    {flagEmoji(code)} {code} — {code === website.defaultLocale ? "default" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!hasSlugInSchema && (
            <div className="field">
              <label htmlFor="slug">Slug</label>
              <input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                required
              />
            </div>
          )}

          {current ? (
            <div className="field">
              <label htmlFor="createdBy">Creator</label>
              <input
                id="createdBy"
                value={
                  current.createdBy
                    ? current.createdBy.name?.trim() ||
                      current.createdBy.email
                    : "—"
                }
                readOnly
                disabled
                title={
                  current.createdBy
                    ? `${current.createdBy.email} (${current.createdBy.id})`
                    : "No creator recorded (legacy or system entry)"
                }
              />
            </div>
          ) : null}

          {fields.map((f) =>
            isSlugField(f) ? (
              <div className="field" key={f.id}>
                <label htmlFor="slug">
                  {f.name}
                  {f.required ? " *" : ""}
                </label>
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                  required
                />
              </div>
            ) : (
              <div className="field" key={f.id}>
                <label htmlFor={f.apiId}>
                  {f.name}
                  {f.required ? " *" : ""}
                </label>
                <FieldInput
                  field={f}
                  value={values[f.apiId]}
                  onChange={(v) => setField(f.apiId, v)}
                />
              </div>
            ),
          )}

          {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}

          <div className="actions">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={pending}
              onClick={() => void save(true)}
            >
              Save & publish
            </button>
            {current?.status === "published" && (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={pending}
                onClick={() => void unpublish()}
              >
                Unpublish
              </button>
            )}
            {current && (
              <button
                className="btn btn-danger"
                type="button"
                disabled={pending}
                onClick={() => void remove()}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>

      {current && (
        <EntryVersions
          contentTypeApiId={contentType.apiId}
          entryId={current.id}
          refreshKey={versionsKey}
          onRestored={(next) => {
            applyEntry(next);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "boolean":
      return (
        <input
          id={field.apiId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "number":
      return (
        <input
          id={field.apiId}
          type="number"
          value={typeof value === "number" ? value : Number(value) || 0}
          onChange={(e) => onChange(Number(e.target.value))}
          required={field.required}
        />
      );
    case "datetime":
      return (
        <input
          id={field.apiId}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) =>
            onChange(e.target.value ? new Date(e.target.value).toISOString() : "")
          }
          required={field.required}
        />
      );
    case "textarea":
      return (
        <textarea
          id={field.apiId}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        />
      );
    case "richtext":
      return (
        <RichTextEditor
          id={field.apiId}
          value={String(value ?? "")}
          onChange={onChange}
          required={field.required}
        />
      );
    case "media":
      return (
        <MediaFieldInput
          id={field.apiId}
          value={value}
          onChange={(v) => onChange(v)}
          required={field.required}
        />
      );
    case "relation":
      return (
        <RelationFieldInput
          id={field.apiId}
          relatedContentTypeApiId={
            field.settings?.relatedContentTypeApiId ?? ""
          }
          multiple={false}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          required={field.required}
        />
      );
    case "relations":
      return (
        <RelationFieldInput
          id={field.apiId}
          relatedContentTypeApiId={
            field.settings?.relatedContentTypeApiId ?? ""
          }
          multiple
          value={Array.isArray(value) ? value.filter((v) => typeof v === "string") : []}
          onChange={onChange}
          required={field.required}
        />
      );
    default:
      return (
        <input
          id={field.apiId}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        />
      );
  }
}

function RelationFieldInput({
  id,
  relatedContentTypeApiId,
  multiple,
  value,
  onChange,
  required,
}: {
  id: string;
  relatedContentTypeApiId: string;
  multiple: boolean;
  value: string | string[];
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const [options, setOptions] = useState<FlatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!relatedContentTypeApiId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const client = getBrowserAdminClient();
        const items: FlatEntry[] = [];
        let offset = 0;
        const pageSize = 100;
        for (;;) {
          const page = await client.listAdminEntries(relatedContentTypeApiId, {
            limit: pageSize,
            offset,
          });
          items.push(...page.items);
          offset += page.items.length;
          if (page.items.length < pageSize || offset >= page.total) break;
        }
        if (!cancelled) setOptions(items);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load related entries",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [relatedContentTypeApiId]);

  function labelFor(entry: FlatEntry): string {
    const title =
      typeof entry.fields.title === "string"
        ? entry.fields.title
        : typeof entry.fields.name === "string"
          ? entry.fields.name
          : null;
    return title && title !== entry.slug
      ? `${title} (${entry.slug})`
      : entry.slug;
  }

  if (!relatedContentTypeApiId) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        This relation field has no related content type configured.
      </p>
    );
  }

  if (multiple) {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <div id={id} style={{ display: "grid", gap: "0.35rem" }}>
        {loading && <span className="muted">Loading entries…</span>}
        {loadError && (
          <span style={{ color: "var(--danger)" }}>{loadError}</span>
        )}
        {!loading && options.length === 0 && (
          <span className="muted">No entries in {relatedContentTypeApiId}.</span>
        )}
        {options.map((entry) => (
          <label
            key={entry.id}
            style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
          >
            <input
              type="checkbox"
              checked={selected.has(entry.slug)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(entry.slug)) next.delete(entry.slug);
                else next.add(entry.slug);
                // Preserve option order
                onChange(
                  options
                    .map((o) => o.slug)
                    .filter((slug) => next.has(slug)),
                );
              }}
            />
            <span>
              {labelFor(entry)}{" "}
              <span className="muted">{entry.status}</span>
            </span>
          </label>
        ))}
        {required && selected.size === 0 ? (
          <input
            tabIndex={-1}
            value=""
            required
            onChange={() => undefined}
            style={{
              position: "absolute",
              opacity: 0,
              height: 0,
              width: 0,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <select
        id={id}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={loading}
      >
        <option value="">{loading ? "Loading…" : "— Select —"}</option>
        {options.map((entry) => (
          <option key={entry.id} value={entry.slug}>
            {labelFor(entry)} ({entry.status})
          </option>
        ))}
      </select>
      {loadError && (
        <p style={{ color: "var(--danger)", margin: "0.35rem 0 0" }}>
          {loadError}
        </p>
      )}
    </div>
  );
}

function mediaUrl(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : "";
  }
  return "";
}

function mediaAlt(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const alt = (value as { alt?: unknown }).alt;
    return typeof alt === "string" ? alt : "";
  }
  return "";
}

function MediaFieldInput({
  id,
  value,
  onChange,
  required,
}: {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [imagekitReady, setImagekitReady] = useState(false);
  const url = mediaUrl(value);
  const alt = mediaAlt(value);

  useEffect(() => {
    setPreviewFailed(false);
  }, [url]);

  useEffect(() => {
    getBrowserAdminClient()
      .getMediaStatus()
      .then((s) => setImagekitReady(s.imagekitConfigured))
      .catch(() => setImagekitReady(false));
  }, []);

  function emit(nextUrl: string, nextAlt: string, extra?: Record<string, unknown>) {
    if (!nextUrl.trim()) {
      onChange("");
      return;
    }
    onChange({
      url: nextUrl.trim(),
      alt: nextAlt,
      width: null,
      height: null,
      mimeType: extra?.mimeType ?? null,
      ...extra,
    });
  }

  function selectFromLibrary(item: MediaLibraryItem) {
    emit(item.url, alt || item.name, {
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      fileId: item.fileId,
    });
  }

  async function onFileSelected(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await getBrowserAdminClient().uploadMedia(file, file.name);
      emit(result.url, alt || file.name, {
        mimeType: result.mimeType ?? null,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="media-field">
      {url ? (
        <div className="media-field-preview">
          {!previewFailed ? (
            // referrerPolicy: ImageKit (and similar CDNs) may 403 when Referer is localhost
            // or an origin not on their allowlist — omit the referrer for previews.
            <img
              src={url}
              alt={alt || "Uploaded image"}
              referrerPolicy="no-referrer"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <div className="media-field-preview-fallback">
              <p className="muted" style={{ margin: 0 }}>
                Preview blocked by the CDN (image is still saved).
              </p>
              <a href={url} target="_blank" rel="noreferrer">
                Open image
              </a>
            </div>
          )}
        </div>
      ) : null}
      {url ? (
        <p className="muted media-field-status" style={{ margin: 0 }}>
          Image attached ·{" "}
          <a href={url} target="_blank" rel="noreferrer">
            open
          </a>
        </p>
      ) : null}
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={uploading}
        onChange={(e) => {
          void onFileSelected(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        type="url"
        value={url}
        onChange={(e) => emit(e.target.value, alt)}
        placeholder="Or paste image URL"
        required={required}
        disabled={uploading}
      />
      <input
        type="text"
        value={alt}
        onChange={(e) => emit(url, e.target.value)}
        placeholder="Alt text"
        disabled={uploading || !url}
      />
      <div className="media-field-actions">
        {imagekitReady ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={uploading}
            onClick={() => setLibraryOpen(true)}
          >
            Browse library
          </button>
        ) : null}
        {url ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={uploading}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        ) : null}
        {uploading ? <span className="muted">Uploading…</span> : null}
      </div>
      {uploadError ? (
        <p style={{ color: "var(--danger)", margin: 0 }}>{uploadError}</p>
      ) : null}
      <MediaLibraryOverlay
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={selectFromLibrary}
      />
    </div>
  );
}

function toLocalInput(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
