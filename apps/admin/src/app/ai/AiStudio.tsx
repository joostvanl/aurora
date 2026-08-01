"use client";

import type { AiStatus } from "@cms/shared";
import { useEffect, useState } from "react";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";

/** Provider configuration only — chat lives in the studio AI dock. */
export function AiStudio() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  async function refreshStatus() {
    const s = await getBrowserAdminClient().getAiStatus();
    setStatus(s);
    setBaseUrl(s.baseUrl ?? "");
    setModel(s.model ?? "");
  }

  useEffect(() => {
    setIsAdmin(getStoredUser()?.role === "admin");
    refreshStatus().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load AI status"),
    );
  }, []);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateAiConfig({
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setStatus(s);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setSaving(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateAiConfig({
        clearApiKey: true,
      });
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {isAdmin ? (
        <div className="panel">
          <h2
            style={{
              marginTop: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 500,
            }}
          >
            Provider config
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Configure an OpenAI-compatible Chat Completions API for{" "}
            <strong>this website only</strong>. Day-to-day AI chat lives in the
            right-hand assistant dock on every studio page.
          </p>
          <div style={{ marginBottom: "1rem" }}>
            Status:{" "}
            <span
              className="badge"
              data-status={status?.enabled ? "published" : "draft"}
            >
              {status?.enabled ? "enabled" : "not configured"}
            </span>{" "}
            <span className="muted">
              · source {status?.source ?? "…"}
              {status?.apiKeyPreview ? ` · key ${status.apiKeyPreview}` : ""}
            </span>
          </div>
          <form className="form" onSubmit={saveConfig}>
            <div className="field">
              <label htmlFor="baseUrl">Base URL</label>
              <input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="field">
              <label htmlFor="apiKey">API key</label>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  status?.apiKeyConfigured
                    ? "Leave blank to keep current key"
                    : "sk-..."
                }
              />
            </div>
            <div className="actions">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save config"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={saving || !status?.apiKeyConfigured}
                onClick={() => void clearKey()}
              >
                Clear stored key
              </button>
            </div>
          </form>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      ) : (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Status:{" "}
            <span
              className="badge"
              data-status={status?.enabled ? "published" : "draft"}
            >
              {status?.enabled ? "enabled" : "not configured"}
            </span>
            {" · "}
            Chat with the assistant in the right-hand dock. Only website admins
            can change AI provider settings.
          </p>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
