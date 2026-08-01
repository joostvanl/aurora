"use client";

import { useEffect, useState } from "react";
import type { WebsiteDetails } from "@cms/shared";
import {
  getBrowserAdminClient,
  storeSession,
  syncSessionCookie,
} from "@/lib/auth";

export function WebsiteSettings() {
  const [website, setWebsite] = useState<WebsiteDetails | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowedOriginsText, setAllowedOriginsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getBrowserAdminClient()
      .getWebsite()
      .then((w) => {
        setWebsite(w);
        setName(w.name);
        setDescription(w.description ?? "");
        setAllowedOriginsText((w.allowedOrigins ?? []).join("\n"));
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load website",
        ),
      );
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const allowedOrigins = allowedOriginsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await getBrowserAdminClient().updateWebsite({
        name: name.trim(),
        description,
        allowedOrigins,
      });
      setWebsite(res.website);
      setName(res.website.name);
      setDescription(res.website.description ?? "");
      setAllowedOriginsText((res.website.allowedOrigins ?? []).join("\n"));
      if (res.token && res.user) {
        storeSession(res.token, res.user);
        await syncSessionCookie(res.token);
      }
      setInfo("Website settings saved.");
      // Refresh shell labels (website name in sidebar).
      window.setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPending(false);
    }
  }

  async function copySiteKey() {
    if (!website?.siteKey) return;
    try {
      await navigator.clipboard.writeText(website.siteKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy site key");
    }
  }

  if (!website && !error) {
    return <p className="muted">Loading website…</p>;
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem", maxWidth: "36rem" }}>
      {error && (
        <p className="muted" style={{ color: "var(--danger, #c44)" }}>
          {error}
        </p>
      )}
      {info && <p className="muted">{info}</p>}

      <form className="panel" onSubmit={(e) => void save(e)}>
        <div style={{ display: "grid", gap: "0.85rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              disabled={pending}
              autoComplete="organization"
            />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Shown in Aurora (sidebar, website switcher). Not the public site
              title — use site_settings for brand chrome.
            </span>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Internal description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={pending}
              placeholder="Optional note for admins (not public)"
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Allowed frontend origins (CORS)</span>
            <textarea
              value={allowedOriginsText}
              onChange={(e) => setAllowedOriginsText(e.target.value)}
              rows={4}
              disabled={pending}
              placeholder={"http://localhost:5180\nhttps://app.example.com"}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}
            />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              One origin per line (scheme + host + port). Frontends for this
              website may call the API from these origins. Studio defaults still
              come from server <code>CORS_ORIGINS</code>.
            </span>
          </label>

          <button className="btn" type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {website && (
        <div className="panel" style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Site key (public read key)
            </div>
            <code style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
              {website.siteKey}
            </code>
            <div style={{ marginTop: "0.5rem" }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void copySiteKey()}
              >
                {copied ? "Copied" : "Copy site key"}
              </button>
            </div>
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
              Immutable identifier for frontends (`x-site-key`). Cannot be
              changed here.
            </p>
          </div>
          <div className="muted" style={{ fontSize: "0.75rem" }}>
            <div>Id: {website.id}</div>
            <div>Created: {new Date(website.createdAt).toLocaleString()}</div>
            <div>Updated: {new Date(website.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
