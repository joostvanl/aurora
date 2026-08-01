"use client";

import type { ContentType, FieldDefinition, FlatEntry } from "@cms/shared";
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
import { RichTextEditor } from "@/components/RichTextEditor";

function fieldDefault(type: FieldDefinition["type"]): unknown {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
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

export function EntryEditor({
  contentType,
  entry,
}: {
  contentType: ContentType;
  entry?: FlatEntry;
}) {
  const router = useRouter();
  const { setHints } = useAiScreen();
  const fields = contentType.fields ?? [];
  const [current, setCurrent] = useState<FlatEntry | undefined>(entry);
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    valuesFromEntry(fields, entry),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);

  useEffect(() => {
    setCurrent(entry);
    setSlug(entry?.slug ?? "");
    setValues(valuesFromEntry(fields, entry));
  }, [entry?.id, entry?.updatedAt, contentType.apiId, fields]);

  useEffect(() => {
    setHints({
      page: current
        ? `Entry editor · ${current.slug}`
        : `New ${contentType.name}`,
      contentTypeApiId: contentType.apiId,
      entryId: current?.id,
    });
    return () => setHints(null);
  }, [setHints, contentType.apiId, contentType.name, current?.id, current?.slug]);

  useEffect(() => {
    return onAiEntryUpdated((detail) => {
      if (current?.id && detail.entry.id === current.id) {
        applyEntry(detail.entry);
      }
    });
  }, [current?.id, fields]);

  useEffect(() => {
    return onAiStudioMutated(() => {
      const entryId = current?.id;
      if (!entryId) return;
      getBrowserAdminClient()
        .getAdminEntry(contentType.apiId, entryId)
        .then((fresh) => {
          setCurrent(fresh);
          setSlug(fresh.slug);
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
    setValues(valuesFromEntry(fields, next));
    setVersionsKey((k) => k + 1);
  }

  const title = useMemo(
    () => (current ? `Edit ${current.slug}` : `New ${contentType.name}`),
    [current, contentType.name],
  );

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

      <div className="panel">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
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

          {fields
            .filter((f) => f.apiId !== "slug")
            .map((f) => (
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
            ))}

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
          value={String(value ?? "")}
          onChange={(v) => onChange(v)}
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

function MediaFieldInput({
  id,
  value,
  onChange,
  required,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onFileSelected(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await getBrowserAdminClient().uploadMedia(file, file.name);
      onChange(result.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="media-field">
      {value ? (
        <div className="media-field-preview">
          {/* Preview uses absolute API URLs outside Next image config */}
          <img src={value} alt="" />
        </div>
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or paste image URL"
        required={required}
        disabled={uploading}
      />
      <div className="media-field-actions">
        {value ? (
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
