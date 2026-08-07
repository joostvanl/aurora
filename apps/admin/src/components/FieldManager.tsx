"use client";

import type {
  ContentFormat,
  ContentType,
  FieldDefinition,
  FieldType,
} from "@cms/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";
import { onAiStudioMutated } from "@/components/AiScreenContext";

const FIELD_TYPES: FieldType[] = [
  "text",
  "textarea",
  "richtext",
  "boolean",
  "datetime",
  "number",
  "slug",
  "username",
  "password",
  "media",
  "relation",
  "relations",
];

function fieldTypeLabel(type: FieldType): string {
  if (type === "media") return "Image (upload)";
  if (type === "relation") return "Relation (single)";
  if (type === "relations") return "Relations (multi)";
  if (type === "username") return "Username";
  if (type === "password") return "Password (hashed)";
  return type;
}

function isRelationType(type: FieldType): boolean {
  return type === "relation" || type === "relations";
}

function supportsContentFormat(type: FieldType): boolean {
  return (
    type === "textarea" ||
    type === "richtext" ||
    type === "text" ||
    type === "username"
  );
}

function buildFieldSettings(
  type: FieldType,
  relatedContentTypeApiId: string,
  contentFormat: ContentFormat,
): Record<string, unknown> | null {
  const settings: Record<string, unknown> = {};
  if (isRelationType(type)) {
    settings.relatedContentTypeApiId = relatedContentTypeApiId;
  }
  if (supportsContentFormat(type)) {
    settings.contentFormat = type === "richtext" ? "html" : contentFormat;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

type Draft = {
  name: string;
  type: FieldType;
  required: boolean;
  relatedContentTypeApiId: string;
  contentFormat: ContentFormat;
};

export function FieldManager({ contentType }: { contentType: ContentType }) {
  const router = useRouter();
  const [ctype, setCtype] = useState(contentType);
  const fields = useMemo(
    () =>
      [...(ctype.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [ctype.fields],
  );
  const [allTypes, setAllTypes] = useState<ContentType[]>([]);
  const [apiId, setApiId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [required, setRequired] = useState(false);
  const [relatedContentTypeApiId, setRelatedContentTypeApiId] = useState("");
  const [contentFormat, setContentFormat] = useState<ContentFormat>("plain");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [typeName, setTypeName] = useState(contentType.name);
  const [typeDescription, setTypeDescription] = useState(
    contentType.description ?? "",
  );
  const [metaPending, setMetaPending] = useState(false);

  const otherTypes = allTypes.filter((t) => t.apiId !== contentType.apiId);

  useEffect(() => {
    setCtype(contentType);
    setTypeName(contentType.name);
    setTypeDescription(contentType.description ?? "");
  }, [contentType]);

  useEffect(() => {
    getBrowserAdminClient()
      .listAdminContentTypes()
      .then(setAllTypes)
      .catch(() => setAllTypes([]));
  }, []);

  useEffect(() => {
    return onAiStudioMutated(() => {
      getBrowserAdminClient()
        .getContentType(contentType.apiId)
        .then((fresh) => {
          setCtype(fresh);
          setTypeName(fresh.name);
          setTypeDescription(fresh.description ?? "");
        })
        .catch(() => {
          /* keep current */
        });
      router.refresh();
    });
  }, [contentType.apiId, router]);

  async function saveContentTypeMeta(e: React.FormEvent) {
    e.preventDefault();
    setMetaPending(true);
    setError(null);
    try {
      const fresh = await getBrowserAdminClient().updateContentType(
        contentType.apiId,
        {
          name: typeName.trim(),
          description: typeDescription.trim() || null,
        },
      );
      setCtype(fresh);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update type");
    } finally {
      setMetaPending(false);
    }
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().createField(contentType.apiId, {
        apiId,
        name,
        type,
        required,
        settings: buildFieldSettings(type, relatedContentTypeApiId, contentFormat),
      });
      setApiId("");
      setName("");
      setType("text");
      setRequired(false);
      setRelatedContentTypeApiId("");
      setContentFormat("plain");
      const fresh = await getBrowserAdminClient().getContentType(
        contentType.apiId,
      );
      setCtype(fresh);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  function startEdit(field: FieldDefinition) {
    setEditingId(field.apiId);
    setDraft({
      name: field.name,
      type: field.type,
      required: field.required,
      relatedContentTypeApiId:
        field.settings?.relatedContentTypeApiId ?? "",
      contentFormat:
        field.type === "richtext"
          ? "html"
          : ((field.settings?.contentFormat as ContentFormat | undefined) ??
            "plain"),
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  async function saveEdit(fieldApiId: string) {
    if (!draft) return;
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().updateField(contentType.apiId, fieldApiId, {
        name: draft.name.trim(),
        type: draft.type,
        required: draft.required,
        settings: buildFieldSettings(
          draft.type,
          draft.relatedContentTypeApiId,
          draft.contentFormat,
        ),
      });
      setEditingId(null);
      setDraft(null);
      setCtype(await getBrowserAdminClient().getContentType(contentType.apiId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update field");
    } finally {
      setPending(false);
    }
  }

  async function removeField(fieldApiId: string) {
    if (!confirm(`Delete field "${fieldApiId}"?`)) return;
    await getBrowserAdminClient().deleteField(contentType.apiId, fieldApiId);
    if (editingId === fieldApiId) cancelEdit();
    setCtype(await getBrowserAdminClient().getContentType(contentType.apiId));
    router.refresh();
  }

  const [dragApiId, setDragApiId] = useState<string | null>(null);
  const [dropTargetApiId, setDropTargetApiId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  async function persistOrder(ordered: FieldDefinition[]) {
    setReordering(true);
    setError(null);
    try {
      const client = getBrowserAdminClient();
      // Optimistic local update with sequential sortOrder
      setCtype((prev) => ({
        ...prev,
        fields: ordered.map((f, i) => ({ ...f, sortOrder: i })),
      }));
      await Promise.all(
        ordered.map((f, i) =>
          client.updateField(contentType.apiId, f.apiId, { sortOrder: i }),
        ),
      );
      setCtype(await client.getContentType(contentType.apiId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder fields");
      setCtype(await getBrowserAdminClient().getContentType(contentType.apiId));
    } finally {
      setReordering(false);
    }
  }

  function onDragStart(apiId: string, e: React.DragEvent) {
    if (editingId || reordering) {
      e.preventDefault();
      return;
    }
    setDragApiId(apiId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", apiId);
  }

  function onDragOverRow(apiId: string, e: React.DragEvent) {
    if (!dragApiId || dragApiId === apiId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetApiId(apiId);
  }

  function onDropRow(targetApiId: string, e: React.DragEvent) {
    e.preventDefault();
    const sourceApiId = dragApiId ?? e.dataTransfer.getData("text/plain");
    setDragApiId(null);
    setDropTargetApiId(null);
    if (!sourceApiId || sourceApiId === targetApiId || editingId) return;

    const from = fields.findIndex((f) => f.apiId === sourceApiId);
    const to = fields.findIndex((f) => f.apiId === targetApiId);
    if (from < 0 || to < 0) return;

    const next = fields.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistOrder(next);
  }

  function onDragEnd() {
    setDragApiId(null);
    setDropTargetApiId(null);
  }

  function relationHint(field: FieldDefinition): string | null {
    if (!isRelationType(field.type)) return null;
    const target = field.settings?.relatedContentTypeApiId;
    return target ? `→ ${target}` : "→ (unset)";
  }

  function formatHint(field: FieldDefinition): string | null {
    if (!supportsContentFormat(field.type)) return null;
    const fmt =
      field.settings?.contentFormat ??
      (field.type === "richtext" ? "html" : "plain");
    return fmt;
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontWeight: 500 }}>
          Content type
        </h2>
        <form className="form" onSubmit={saveContentTypeMeta}>
          <div className="field">
            <label htmlFor="ct-name">Name</label>
            <input
              id="ct-name"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ct-desc">Description</label>
            <textarea
              id="ct-desc"
              value={typeDescription}
              onChange={(e) => setTypeDescription(e.target.value)}
              rows={2}
            />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            API ID <code>{contentType.apiId}</code> cannot be changed (used in
            routes and clients).
          </p>
          <button className="btn" type="submit" disabled={metaPending}>
            {metaPending ? "Saving…" : "Save content type"}
          </button>
        </form>
      </div>

      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Drag the handle to reorder fields.
          {reordering ? " Saving order…" : null}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }} aria-label="Reorder" />
              <th>Name</th>
              <th>API ID</th>
              <th>Type</th>
              <th>Required</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const isEditing = editingId === f.apiId && draft;
              const isDragging = dragApiId === f.apiId;
              const isDropTarget =
                dropTargetApiId === f.apiId && dragApiId !== f.apiId;
              return (
                <tr
                  key={f.id}
                  className={[
                    "field-row",
                    isDragging ? "is-dragging" : "",
                    isDropTarget ? "is-drop-target" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onDragOver={(e) => onDragOverRow(f.apiId, e)}
                  onDrop={(e) => onDropRow(f.apiId, e)}
                >
                  <td className="field-drag-cell">
                    <button
                      type="button"
                      className="field-drag-handle"
                      draggable={!isEditing && !reordering}
                      onDragStart={(e) => onDragStart(f.apiId, e)}
                      onDragEnd={onDragEnd}
                      disabled={Boolean(isEditing) || reordering}
                      aria-label={`Drag to reorder ${f.name}`}
                      title="Drag to reorder"
                    >
                      ⋮⋮
                    </button>
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          setDraft({ ...draft, name: e.target.value })
                        }
                        required
                      />
                    ) : (
                      f.name
                    )}
                  </td>
                  <td>
                    <code>{f.apiId}</code>
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <select
                          value={draft.type}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              type: e.target.value as FieldType,
                            })
                          }
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {fieldTypeLabel(t)}
                            </option>
                          ))}
                        </select>
                        {isRelationType(draft.type) && (
                          <select
                            value={draft.relatedContentTypeApiId}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                relatedContentTypeApiId: e.target.value,
                              })
                            }
                            required
                          >
                            <option value="">Related content type…</option>
                            {otherTypes.map((t) => (
                              <option key={t.apiId} value={t.apiId}>
                                {t.name} ({t.apiId})
                              </option>
                            ))}
                          </select>
                        )}
                        {supportsContentFormat(draft.type) && (
                          <select
                            value={
                              draft.type === "richtext"
                                ? "html"
                                : draft.contentFormat
                            }
                            disabled={draft.type === "richtext"}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                contentFormat: e.target.value as ContentFormat,
                              })
                            }
                            aria-label="Content format"
                          >
                            <option value="plain">plain</option>
                            <option value="markdown">markdown</option>
                            <option value="html">html</option>
                          </select>
                        )}
                      </div>
                    ) : (
                      <>
                        {fieldTypeLabel(f.type)}
                        {relationHint(f) ? (
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {relationHint(f)}
                          </div>
                        ) : null}
                        {formatHint(f) ? (
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            format: {formatHint(f)}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={draft.required}
                        onChange={(e) =>
                          setDraft({ ...draft, required: e.target.checked })
                        }
                      />
                    ) : f.required ? (
                      "yes"
                    ) : (
                      "no"
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      {isEditing ? (
                        <>
                          <button
                            className="btn"
                            type="button"
                            disabled={
                              pending ||
                              !draft.name.trim() ||
                              (isRelationType(draft.type) &&
                                !draft.relatedContentTypeApiId)
                            }
                            onClick={() => void saveEdit(f.apiId)}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={pending}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            onClick={() => startEdit(f)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-danger"
                            type="button"
                            onClick={() => removeField(f.apiId)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {fields.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No fields yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && (
          <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>{error}</p>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontWeight: 500 }}>
          Add field
        </h2>
        <form className="form" onSubmit={addField}>
          <div className="field">
            <label htmlFor="fname">Name</label>
            <input
              id="fname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="fapi">API ID</label>
            <input
              id="fapi"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              pattern="^[a-z][a-z0-9_]*$"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ftype">Type</label>
            <select
              id="ftype"
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {fieldTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          {isRelationType(type) && (
            <div className="field">
              <label htmlFor="frelated">Related content type</label>
              <select
                id="frelated"
                value={relatedContentTypeApiId}
                onChange={(e) => setRelatedContentTypeApiId(e.target.value)}
                required
              >
                <option value="">Select content type…</option>
                {otherTypes.map((t) => (
                  <option key={t.apiId} value={t.apiId}>
                    {t.name} ({t.apiId})
                  </option>
                ))}
              </select>
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                Stores entry slug{type === "relations" ? "s" : ""} of the related
                type.
              </p>
            </div>
          )}
          {supportsContentFormat(type) && (
            <div className="field">
              <label htmlFor="fformat">Content format</label>
              <select
                id="fformat"
                value={type === "richtext" ? "html" : contentFormat}
                disabled={type === "richtext"}
                onChange={(e) =>
                  setContentFormat(e.target.value as ContentFormat)
                }
              >
                <option value="plain">plain</option>
                <option value="markdown">markdown</option>
                <option value="html">html</option>
              </select>
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                Clients should render using this format (richtext is always
                HTML).
              </p>
            </div>
          )}
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required
          </label>
          <button
            className="btn"
            type="submit"
            disabled={
              pending ||
              (isRelationType(type) && !relatedContentTypeApiId)
            }
          >
            {pending ? "Adding…" : "Add field"}
          </button>
        </form>
      </div>
    </div>
  );
}
