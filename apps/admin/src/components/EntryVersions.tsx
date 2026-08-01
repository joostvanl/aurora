"use client";

import type { EntryVersion, FlatEntry } from "@cms/shared";
import { useCallback, useEffect, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

export function EntryVersions({
  contentTypeApiId,
  entryId,
  onRestored,
  refreshKey,
}: {
  contentTypeApiId: string;
  entryId: string;
  onRestored: (entry: FlatEntry) => void;
  refreshKey?: string | number;
}) {
  const [versions, setVersions] = useState<EntryVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await getBrowserAdminClient().listEntryVersions(
        contentTypeApiId,
        entryId,
      );
      setVersions(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    }
  }, [contentTypeApiId, entryId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function checkpoint() {
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().createEntryVersion(contentTypeApiId, entryId, {
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
    if (!confirm("Restore this version? Current state will be saved as a checkpoint first.")) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await getBrowserAdminClient().restoreEntryVersion(
        contentTypeApiId,
        entryId,
        versionId,
      );
      onRestored(res.entry);
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
          Versions
        </strong>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending}
          onClick={() => void checkpoint()}
        >
          Save checkpoint
        </button>
      </div>
      <p className="muted" style={{ marginTop: "0.5rem" }}>
        AI edits snapshot the entry first. Restore any version to undo.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <table className="table" style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>When</th>
            <th>Label</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
              <td>{v.label ?? "—"}</td>
              <td>
                <span className="badge" data-status={v.source === "ai" ? "draft" : "published"}>
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
              <td colSpan={4} className="empty">
                No versions yet. AI edits or a manual checkpoint will appear here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
