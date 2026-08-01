"use client";

import type { ContentType, FieldDefinition, FieldType } from "@cms/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  "media",
];

function fieldTypeLabel(type: FieldType): string {
  return type === "media" ? "Image (upload)" : type;
}

type Draft = {
  name: string;
  type: FieldType;
  required: boolean;
};

export function FieldManager({ contentType }: { contentType: ContentType }) {
  const router = useRouter();
  const [ctype, setCtype] = useState(contentType);
  const fields = ctype.fields ?? [];
  const [apiId, setApiId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [typeName, setTypeName] = useState(contentType.name);
  const [typeDescription, setTypeDescription] = useState(
    contentType.description ?? "",
  );
  const [metaPending, setMetaPending] = useState(false);

  useEffect(() => {
    setCtype(contentType);
    setTypeName(contentType.name);
    setTypeDescription(contentType.description ?? "");
  }, [contentType]);

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
      });
      setApiId("");
      setName("");
      setType("text");
      setRequired(false);
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

  async function move(fieldApiId: string, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.apiId === fieldApiId);
    const swap = fields[index + direction];
    if (!swap) return;
    const client = getBrowserAdminClient();
    await Promise.all([
      client.updateField(contentType.apiId, fields[index].apiId, {
        sortOrder: swap.sortOrder,
      }),
      client.updateField(contentType.apiId, swap.apiId, {
        sortOrder: fields[index].sortOrder,
      }),
    ]);
    setCtype(await client.getContentType(contentType.apiId));
    router.refresh();
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
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>API ID</th>
              <th>Type</th>
              <th>Required</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const isEditing = editingId === f.apiId && draft;
              return (
                <tr key={f.id}>
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
                    ) : (
                      fieldTypeLabel(f.type)
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
                            disabled={pending || !draft.name.trim()}
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
                            className="btn btn-secondary"
                            type="button"
                            disabled={i === 0}
                            onClick={() => move(f.apiId, -1)}
                          >
                            Up
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={i === fields.length - 1}
                            onClick={() => move(f.apiId, 1)}
                          >
                            Down
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
                <td colSpan={5} className="empty">
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
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required
          </label>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add field"}
          </button>
        </form>
      </div>
    </div>
  );
}
