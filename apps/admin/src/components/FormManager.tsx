"use client";

import type { Form, FormField, FormFieldType } from "@cms/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";
import { onAiStudioMutated } from "@/components/AiScreenContext";

const FIELD_TYPES: FormFieldType[] = [
  "text",
  "email",
  "phone",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "honeypot",
];

type Draft = {
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder: string;
  helpText: string;
  optionsText: string;
};

function optionsToText(
  options: Array<{ value: string; label: string }> | null | undefined,
): string {
  if (!options?.length) return "";
  return options.map((o) => `${o.value}|${o.label}`).join("\n");
}

function textToOptions(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...rest] = line.split("|");
      const label = rest.join("|").trim() || value;
      return { value: value.trim(), label };
    });
}

export function FormManager({ form }: { form: Form }) {
  const router = useRouter();
  const [current, setCurrent] = useState(form);
  const fields = current.fields ?? [];
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description ?? "");
  const [submitLabel, setSubmitLabel] = useState(form.submitLabel);
  const [successMessage, setSuccessMessage] = useState(form.successMessage);
  const [enabled, setEnabled] = useState(form.enabled);
  const [metaPending, setMetaPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [apiId, setApiId] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FormFieldType>("text");
  const [required, setRequired] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [helpText, setHelpText] = useState("");
  const [optionsText, setOptionsText] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    setCurrent(form);
    setName(form.name);
    setDescription(form.description ?? "");
    setSubmitLabel(form.submitLabel);
    setSuccessMessage(form.successMessage);
    setEnabled(form.enabled);
  }, [form]);

  useEffect(() => {
    return onAiStudioMutated(() => {
      getBrowserAdminClient()
        .getForm(form.apiId)
        .then((fresh) => {
          setCurrent(fresh);
          setName(fresh.name);
          setDescription(fresh.description ?? "");
          setSubmitLabel(fresh.submitLabel);
          setSuccessMessage(fresh.successMessage);
          setEnabled(fresh.enabled);
        })
        .catch(() => {
          /* keep current */
        });
      router.refresh();
    });
  }, [form.apiId, router]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setMetaPending(true);
    setError(null);
    try {
      const fresh = await getBrowserAdminClient().updateForm(form.apiId, {
        name: name.trim(),
        description: description.trim() || null,
        submitLabel: submitLabel.trim(),
        successMessage: successMessage.trim(),
        enabled,
      });
      setCurrent(fresh);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update form");
    } finally {
      setMetaPending(false);
    }
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const needsOptions = type === "select" || type === "radio";
      await getBrowserAdminClient().createFormField(form.apiId, {
        apiId,
        label,
        type,
        required: type === "honeypot" ? false : required,
        placeholder: placeholder.trim() || null,
        helpText: helpText.trim() || null,
        options: needsOptions ? textToOptions(optionsText) : null,
      });
      setApiId("");
      setLabel("");
      setType("text");
      setRequired(false);
      setPlaceholder("");
      setHelpText("");
      setOptionsText("");
      setCurrent(await getBrowserAdminClient().getForm(form.apiId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add field");
    } finally {
      setPending(false);
    }
  }

  function startEdit(field: FormField) {
    setEditingId(field.apiId);
    setDraft({
      label: field.label,
      type: field.type,
      required: field.required,
      placeholder: field.placeholder ?? "",
      helpText: field.helpText ?? "",
      optionsText: optionsToText(field.options),
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
      const needsOptions = draft.type === "select" || draft.type === "radio";
      await getBrowserAdminClient().updateFormField(form.apiId, fieldApiId, {
        label: draft.label.trim(),
        type: draft.type,
        required: draft.type === "honeypot" ? false : draft.required,
        placeholder: draft.placeholder.trim() || null,
        helpText: draft.helpText.trim() || null,
        options: needsOptions ? textToOptions(draft.optionsText) : null,
      });
      cancelEdit();
      setCurrent(await getBrowserAdminClient().getForm(form.apiId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update field");
    } finally {
      setPending(false);
    }
  }

  async function removeField(fieldApiId: string) {
    if (!confirm(`Delete field "${fieldApiId}"?`)) return;
    await getBrowserAdminClient().deleteFormField(form.apiId, fieldApiId);
    if (editingId === fieldApiId) cancelEdit();
    setCurrent(await getBrowserAdminClient().getForm(form.apiId));
    router.refresh();
  }

  async function move(fieldApiId: string, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.apiId === fieldApiId);
    const swap = fields[index + direction];
    if (!swap) return;
    const client = getBrowserAdminClient();
    await Promise.all([
      client.updateFormField(form.apiId, fields[index].apiId, {
        sortOrder: swap.sortOrder,
      }),
      client.updateFormField(form.apiId, swap.apiId, {
        sortOrder: fields[index].sortOrder,
      }),
    ]);
    setCurrent(await client.getForm(form.apiId));
    router.refresh();
  }

  async function removeForm() {
    if (!confirm(`Delete form "${form.apiId}" and all submissions?`)) return;
    await getBrowserAdminClient().deleteForm(form.apiId);
    router.push("/forms");
    router.refresh();
  }

  const showOptions = type === "select" || type === "radio";
  const draftShowOptions =
    draft && (draft.type === "select" || draft.type === "radio");

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="panel">
        <h2
          style={{
            marginTop: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 500,
          }}
        >
          Form settings
        </h2>
        <form className="form" onSubmit={saveMeta}>
          <div className="field">
            <label htmlFor="f-name">Name</label>
            <input
              id="f-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="f-desc">Description</label>
            <textarea
              id="f-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="field">
            <label htmlFor="f-submit">Submit label</label>
            <input
              id="f-submit"
              value={submitLabel}
              onChange={(e) => setSubmitLabel(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="f-success">Success message</label>
            <textarea
              id="f-success"
              value={successMessage}
              onChange={(e) => setSuccessMessage(e.target.value)}
              rows={2}
              required
            />
          </div>
          <label
            style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled (public schema + submit)
          </label>
          <p className="muted" style={{ margin: 0 }}>
            API ID <code>{form.apiId}</code> cannot be changed.
          </p>
          <div className="actions">
            <button className="btn" type="submit" disabled={metaPending}>
              {metaPending ? "Saving…" : "Save settings"}
            </button>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => void removeForm()}
            >
              Delete form
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
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
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <input
                          value={draft.label}
                          onChange={(e) =>
                            setDraft({ ...draft, label: e.target.value })
                          }
                          required
                        />
                        <input
                          value={draft.placeholder}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              placeholder: e.target.value,
                            })
                          }
                          placeholder="Placeholder"
                        />
                        {draftShowOptions && (
                          <textarea
                            value={draft.optionsText}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                optionsText: e.target.value,
                              })
                            }
                            rows={3}
                            placeholder={"value|Label\nother|Other"}
                          />
                        )}
                      </div>
                    ) : (
                      f.label
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
                            type: e.target.value as FormFieldType,
                          })
                        }
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : (
                      f.type
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={draft.required}
                        disabled={draft.type === "honeypot"}
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
                            disabled={pending || !draft.label.trim()}
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
                            onClick={() => void removeField(f.apiId)}
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
          <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>
            {error}
          </p>
        )}
      </div>

      <div className="panel">
        <h2
          style={{
            marginTop: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 500,
          }}
        >
          Add field
        </h2>
        <form className="form" onSubmit={addField}>
          <div className="field">
            <label htmlFor="ff-label">Label</label>
            <input
              id="ff-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ff-api">API ID</label>
            <input
              id="ff-api"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              pattern="^[a-z][a-z0-9_]*$"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ff-type">Type</label>
            <select
              id="ff-type"
              value={type}
              onChange={(e) => setType(e.target.value as FormFieldType)}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ff-ph">Placeholder</label>
            <input
              id="ff-ph"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ff-help">Help text</label>
            <input
              id="ff-help"
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
            />
          </div>
          {showOptions && (
            <div className="field">
              <label htmlFor="ff-opts">Options (one per line: value|Label)</label>
              <textarea
                id="ff-opts"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                required
              />
            </div>
          )}
          <label
            style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
          >
            <input
              type="checkbox"
              checked={required}
              disabled={type === "honeypot"}
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
