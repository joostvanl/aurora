"use client";

import type { ContentType, LocalizationMode } from "@cms/shared";
import { useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

export function LocalizationModeEditor({
  contentType,
}: {
  contentType: ContentType;
}) {
  const [mode, setMode] = useState<LocalizationMode>(
    contentType.localizationMode ?? "explicit",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      await getBrowserAdminClient().updateContentType(contentType.apiId, {
        localizationMode: mode,
      });
      setInfo("Localization mode saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPending(false);
    }
  }

  async function syncLocales() {
    setPending(true);
    setError(null);
    setSyncInfo(null);
    try {
      const result = await getBrowserAdminClient().syncMissingLocales(
        contentType.apiId,
        {},
      );
      setSyncInfo(
        result.created.length
          ? `Created ${result.created.length} missing locale stub(s).`
          : "No missing locales.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Localization</h2>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Per content type. Site languages are configured under Website settings.
      </p>
      <label style={{ display: "grid", gap: "0.35rem", maxWidth: "28rem" }}>
        <span>Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as LocalizationMode)}
          disabled={pending}
        >
          <option value="explicit">
            Explicit languages only — create translations per locale
          </option>
          <option value="all_locales">
            All site languages — create draft stubs for every site locale
          </option>
        </select>
      </label>
      <div className="actions" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? "Saving…" : "Save mode"}
        </button>
        {mode === "all_locales" && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => void syncLocales()}
          >
            Sync missing locales
          </button>
        )}
      </div>
      {error && (
        <p style={{ color: "var(--danger)", marginBottom: 0 }}>{error}</p>
      )}
      {info && <p className="muted">{info}</p>}
      {syncInfo && <p className="muted">{syncInfo}</p>}
    </div>
  );
}
