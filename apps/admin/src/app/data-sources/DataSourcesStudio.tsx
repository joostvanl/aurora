"use client";

import type { PublicExternalSource } from "@cms/shared";
import { EXTERNAL_SOURCES_MAX } from "@cms/shared";
import { useEffect, useState } from "react";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";

type DraftSource = PublicExternalSource & {
  authHeaderValue: string;
  clearAuth: boolean;
};

function toDraft(source: PublicExternalSource): DraftSource {
  return { ...source, authHeaderValue: "", clearAuth: false };
}

function emptyDraft(): DraftSource {
  return {
    id: crypto.randomUUID(),
    label: "",
    type: "mcp_http",
    url: "",
    enabled: true,
    authHeaderName: "Authorization",
    authConfigured: false,
    authPreview: null,
    authHeaderValue: "",
    clearAuth: false,
  };
}

export function DataSourcesStudio() {
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await getBrowserAdminClient().getExternalSources();
    setSources(res.sources.map(toDraft));
    setLoaded(true);
    return res;
  }

  useEffect(() => {
    setIsAdmin(getStoredUser()?.role === "admin");
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load sources"),
    );
  }, []);

  function updateDraft(id: string, patch: Partial<DraftSource>) {
    setSources((current) =>
      current.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = sources.map((s) => ({
        id: s.id,
        label: s.label.trim(),
        type: "mcp_http" as const,
        url: s.url.trim(),
        enabled: s.enabled,
        authHeaderName: s.authHeaderName.trim() || "Authorization",
        ...(s.clearAuth
          ? { clearAuth: true }
          : s.authHeaderValue.trim()
            ? { authHeaderValue: s.authHeaderValue.trim() }
            : {}),
      }));
      const res = await getBrowserAdminClient().replaceExternalSources({
        sources: payload,
      });
      setSources(res.sources.map(toDraft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sources");
    } finally {
      setSaving(false);
    }
  }

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
          MCP-bronnen
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Alleen Streamable HTTP (<code>mcp_http</code>). Studio-AI roept deze
          bronnen aan via vaste tools; het hosted Aurora-<code>/mcp</code>
          endpoint is de omgekeerde richting (Cursor → Aurora). Max{" "}
          {EXTERNAL_SOURCES_MAX} bronnen. Laat het secret-veld leeg om de
          bestaande waarde te bewaren.
        </p>
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : (
          <form className="form" onSubmit={save}>
            {sources.length === 0 ? (
              <p className="muted">Nog geen bronnen. Voeg er een toe.</p>
            ) : null}
            {sources.map((source, index) => (
              <fieldset
                key={source.id}
                style={{
                  border: "1px solid var(--border, #ddd)",
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  marginBottom: "0.75rem",
                }}
              >
                <legend>
                  Bron {index + 1}
                  {source.authConfigured
                    ? ` · secret ${source.authPreview ?? "••••"}`
                    : ""}
                </legend>
                <div className="field">
                  <label htmlFor={`src-label-${source.id}`}>Label</label>
                  <input
                    id={`src-label-${source.id}`}
                    value={source.label}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      updateDraft(source.id, { label: e.target.value })
                    }
                    maxLength={80}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor={`src-url-${source.id}`}>MCP URL</label>
                  <input
                    id={`src-url-${source.id}`}
                    value={source.url}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      updateDraft(source.id, { url: e.target.value })
                    }
                    placeholder="https://example.com/mcp"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor={`src-header-${source.id}`}>Auth header</label>
                  <input
                    id={`src-header-${source.id}`}
                    value={source.authHeaderName}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      updateDraft(source.id, { authHeaderName: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`src-secret-${source.id}`}>
                    Auth value (leeg = ongewijzigd)
                  </label>
                  <input
                    id={`src-secret-${source.id}`}
                    type="password"
                    autoComplete="new-password"
                    value={source.authHeaderValue}
                    disabled={!isAdmin || source.clearAuth}
                    onChange={(e) =>
                      updateDraft(source.id, { authHeaderValue: e.target.value })
                    }
                    placeholder={
                      source.authConfigured ? "••••••••" : "Bearer …"
                    }
                  />
                </div>
                <div className="field" style={{ display: "flex", gap: "1rem" }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        updateDraft(source.id, { enabled: e.target.checked })
                      }
                    />{" "}
                    Enabled
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={source.clearAuth}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        updateDraft(source.id, {
                          clearAuth: e.target.checked,
                          authHeaderValue: "",
                        })
                      }
                    />{" "}
                    Secret wissen
                  </label>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setSources((current) =>
                        current.filter((s) => s.id !== source.id),
                      )
                    }
                  >
                    Verwijderen
                  </button>
                ) : null}
              </fieldset>
            ))}
            {error ? <p className="error">{error}</p> : null}
            {isAdmin ? (
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={sources.length >= EXTERNAL_SOURCES_MAX}
                  onClick={() =>
                    setSources((current) => [...current, emptyDraft()])
                  }
                >
                  Bron toevoegen
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "Opslaan…" : "Opslaan"}
                </button>
              </div>
            ) : (
              <p className="muted">Alleen een admin kan bronnen wijzigen.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
