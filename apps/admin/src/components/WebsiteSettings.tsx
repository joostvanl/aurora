"use client";

import { useEffect, useState } from "react";
import type { WebsiteDetails } from "@cms/shared";
import {
  LOCALE_CATALOG,
  flagEmoji,
  isLocaleCode,
  localeLabel,
} from "@cms/shared";
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
  const [locales, setLocales] = useState<string[]>(["en-US"]);
  const [defaultLocale, setDefaultLocale] = useState("en-US");
  const [addLocale, setAddLocale] = useState("nl-NL");
  const [customLocale, setCustomLocale] = useState("");
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
        setLocales(w.locales?.length ? w.locales : ["en-US"]);
        setDefaultLocale(w.defaultLocale || "en-US");
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load website",
        ),
      );
  }, []);

  function addLocaleCode(code: string) {
    const trimmed = code.trim();
    if (!isLocaleCode(trimmed)) {
      setError("Locale must be language-REGION (e.g. en-US, nl-NL)");
      return;
    }
    if (locales.includes(trimmed)) return;
    setLocales((prev) => [...prev, trimmed]);
    setError(null);
  }

  function removeLocale(code: string) {
    if (locales.length <= 1) {
      setError("At least one locale is required");
      return;
    }
    const next = locales.filter((l) => l !== code);
    setLocales(next);
    if (defaultLocale === code) {
      setDefaultLocale(next[0]!);
    }
  }

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
        locales,
        defaultLocale,
      });
      setWebsite(res.website);
      setName(res.website.name);
      setDescription(res.website.description ?? "");
      setAllowedOriginsText((res.website.allowedOrigins ?? []).join("\n"));
      setLocales(res.website.locales);
      setDefaultLocale(res.website.defaultLocale);
      if (res.token && res.user) {
        storeSession(res.token, res.user);
        await syncSessionCookie(res.token);
      }
      setInfo("Website settings saved.");
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

  const catalogOptions = LOCALE_CATALOG.filter((l) => !locales.includes(l.code));

  return (
    <div style={{ display: "grid", gap: "1.25rem", maxWidth: "40rem" }}>
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

          <div style={{ display: "grid", gap: "0.5rem" }}>
            <span>Languages (BCP-47)</span>
            <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
              Site-wide locales using language-country tags (e.g.{" "}
              <code>en-US</code>, <code>nl-NL</code>). Content entries can only
              use these locales.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
              {locales.map((code) => (
                <li
                  key={code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: "1.25rem" }} aria-hidden>
                    {flagEmoji(code)}
                  </span>
                  <strong>{code}</strong>
                  <span className="muted">{localeLabel(code)}</span>
                  {defaultLocale === code ? (
                    <span className="badge">default</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                      disabled={pending}
                      onClick={() => setDefaultLocale(code)}
                    >
                      Set default
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                    disabled={pending || locales.length <= 1}
                    onClick={() => removeLocale(code)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                value={addLocale}
                onChange={(e) => setAddLocale(e.target.value)}
                disabled={pending || catalogOptions.length === 0}
              >
                {catalogOptions.length === 0 ? (
                  <option value="">All catalog locales added</option>
                ) : (
                  catalogOptions.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.code} — {l.label}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending || !addLocale || catalogOptions.length === 0}
                onClick={() => addLocaleCode(addLocale)}
              >
                Add
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                value={customLocale}
                onChange={(e) => setCustomLocale(e.target.value)}
                placeholder="Custom e.g. pt-BR"
                disabled={pending}
                style={{ maxWidth: "10rem" }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending || !customLocale.trim()}
                onClick={() => {
                  addLocaleCode(customLocale);
                  setCustomLocale("");
                }}
              >
                Add custom
              </button>
            </div>
          </div>

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
