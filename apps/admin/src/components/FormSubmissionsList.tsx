"use client";

import type { FormSubmission } from "@cms/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

function previewPayload(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`);
  return parts.join(" · ") || "(empty)";
}

export function FormSubmissionsList({
  formApiId,
  items,
  total,
}: {
  formApiId: string;
  items: FormSubmission[];
  total: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<FormSubmission | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markRead(submission: FormSubmission, read: boolean) {
    setPending(true);
    setError(null);
    try {
      const updated = await getBrowserAdminClient().updateFormSubmission(
        formApiId,
        submission.id,
        { read },
      );
      setSelected(updated);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  async function remove(submission: FormSubmission) {
    if (!confirm("Delete this submission?")) return;
    setPending(true);
    try {
      await getBrowserAdminClient().deleteFormSubmission(
        formApiId,
        submission.id,
      );
      setSelected(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          {total} submission{total === 1 ? "" : "s"}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Status</th>
              <th>Preview</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>
                  {new Date(s.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
                <td>
                  <span
                    className="badge"
                    data-status={s.readAt ? "published" : "draft"}
                  >
                    {s.readAt ? "read" : "unread"}
                  </span>
                </td>
                <td className="muted" style={{ maxWidth: 280 }}>
                  {previewPayload(s.payload)}
                </td>
                <td>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setSelected(s)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "flex-start",
            }}
          >
            <div>
              <h2
                style={{
                  marginTop: 0,
                  fontFamily: "var(--font-display)",
                  fontWeight: 500,
                }}
              >
                Submission
              </h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {new Date(selected.createdAt).toLocaleString()}
                {" · "}
                <code>{selected.id}</code>
              </p>
            </div>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>

          <dl
            style={{
              display: "grid",
              gap: "0.75rem",
              margin: "0 0 1rem",
            }}
          >
            {Object.entries(selected.payload).map(([key, value]) => (
              <div key={key}>
                <dt
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--muted)",
                  }}
                >
                  {key}
                </dt>
                <dd style={{ margin: "0.15rem 0 0", whiteSpace: "pre-wrap" }}>
                  {typeof value === "boolean"
                    ? value
                      ? "yes"
                      : "no"
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>

          {selected.meta && Object.keys(selected.meta).length > 0 && (
            <details style={{ marginBottom: "1rem" }}>
              <summary className="muted">Meta</summary>
              <pre
                style={{
                  fontSize: "0.8rem",
                  overflow: "auto",
                  background: "var(--bg)",
                  padding: "0.75rem",
                  borderRadius: 8,
                }}
              >
                {JSON.stringify(selected.meta, null, 2)}
              </pre>
            </details>
          )}

          {error && (
            <p style={{ color: "var(--danger)", margin: "0 0 0.75rem" }}>
              {error}
            </p>
          )}

          <div className="actions">
            {!selected.readAt ? (
              <button
                className="btn"
                type="button"
                disabled={pending}
                onClick={() => void markRead(selected, true)}
              >
                Mark read
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={pending}
                onClick={() => void markRead(selected, false)}
              >
                Mark unread
              </button>
            )}
            <button
              className="btn btn-danger"
              type="button"
              disabled={pending}
              onClick={() => void remove(selected)}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <p className="muted">
        <Link href={`/forms/${formApiId}`}>← Back to form builder</Link>
      </p>
    </div>
  );
}
