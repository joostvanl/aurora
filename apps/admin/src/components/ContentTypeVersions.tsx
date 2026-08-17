"use client";

import type {
  AuditEvent,
  ContentType,
  ContentTypeVersion,
  SnapshotDiffChange,
} from "@cms/shared";
import { useCallback, useEffect, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

export function ContentTypeVersions({
  contentType,
  onRestored,
}: {
  contentType: ContentType;
  onRestored?: (next: ContentType) => void;
}) {
  const [versions, setVersions] = useState<ContentTypeVersion[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<SnapshotDiffChange[] | null>(null);

  const load = useCallback(async () => {
    try {
      const client = getBrowserAdminClient();
      const [items, events] = await Promise.all([
        client.listContentTypeVersions(contentType.apiId),
        client.listAuditEvents({
          resourceType: "content_type",
          resourceId: contentType.id,
          limit: 10,
        }),
      ]);
      setVersions(items);
      setAudit(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    }
  }, [contentType.apiId, contentType.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSelect(id: string) {
    setDiff(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  async function compare() {
    if (selected.length !== 2) return;
    setPending(true);
    setError(null);
    try {
      const [from, to] = selected;
      const res = await getBrowserAdminClient().diffContentTypeVersions(
        contentType.apiId,
        from,
        to,
      );
      setDiff(res.changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setPending(false);
    }
  }

  async function checkpoint() {
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().createContentTypeVersion(contentType.apiId, {
        label: "Manual checkpoint",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkpoint failed");
    } finally {
      setPending(false);
    }
  }

  async function restore(versionId: string) {
    if (
      !confirm(
        "Restore this schema version? Current schema will be checkpointed first. Field type changes with existing values may be blocked.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await getBrowserAdminClient().restoreContentTypeVersion(
        contentType.apiId,
        versionId,
      );
      onRestored?.(res.contentType);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: "1rem" }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
          Schema history
        </strong>
        <div className="actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={pending || selected.length !== 2}
            onClick={() => void compare()}
          >
            Compare
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={pending}
            onClick={() => void checkpoint()}
          >
            Save checkpoint
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: "0.5rem" }}>
        Field and type changes create versions automatically.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <table className="table" style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th></th>
            <th>When</th>
            <th>Label</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(v.id)}
                  onChange={() => toggleSelect(v.id)}
                  aria-label={`Select schema version ${v.id}`}
                />
              </td>
              <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
              <td>
                {v.label ?? "—"}
                {v.changeSummary ? (
                  <div className="muted" style={{ fontSize: "0.85em" }}>
                    {v.changeSummary}
                  </div>
                ) : null}
              </td>
              <td>
                <span className="badge" data-status="published">
                  {v.source}
                </span>
              </td>
              <td>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => void restore(v.id)}
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                No schema versions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {diff && (
        <div style={{ marginTop: "1rem" }}>
          <strong>Diff</strong>
          {diff.length === 0 ? (
            <p className="muted">No differences.</p>
          ) : (
            <table className="table" style={{ marginTop: "0.5rem" }}>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((c) => (
                  <tr key={c.path}>
                    <td>
                      <code>{c.path}</code>
                    </td>
                    <td>
                      <code style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(c.before, null, 2)}
                      </code>
                    </td>
                    <td>
                      <code style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(c.after, null, 2)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ marginTop: "1.25rem" }}>
        <strong>Recent activity</strong>
        {audit.length === 0 ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          <table className="table" style={{ marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="muted">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td>
                    <div>{e.summary}</div>
                    {e.aiDetail ? (
                      <div
                        className="muted"
                        style={{
                          marginTop: "0.35rem",
                          paddingTop: "0.35rem",
                          borderTop: "1px solid var(--border)",
                          fontSize: "0.9em",
                        }}
                      >
                        <span
                          className="badge"
                          data-status="draft"
                          style={{ marginRight: "0.4rem" }}
                        >
                          AI-generated
                        </span>
                        {e.aiDetail}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
