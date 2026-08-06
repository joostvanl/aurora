"use client";

import type { MediaProvider, MediaStatus } from "@cms/shared";
import { useEffect, useState } from "react";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";

export function MediaStudio() {
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [provider, setProvider] = useState<MediaProvider>("local");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [urlEndpoint, setUrlEndpoint] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  async function refreshStatus() {
    const s = await getBrowserAdminClient().getMediaStatus();
    setStatus(s);
    setProvider(s.provider);
    setPublicKey(s.publicKey ?? "");
    setUrlEndpoint(s.urlEndpoint ?? "");
    setFolder(s.folder ?? "");
  }

  useEffect(() => {
    setIsAdmin(getStoredUser()?.role === "admin");
    refreshStatus().catch((err) =>
      setError(
        err instanceof Error ? err.message : "Failed to load media status",
      ),
    );
  }, []);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateMediaConfig({
        provider,
        urlEndpoint,
        folder: folder.trim() ? folder.trim() : null,
        ...(publicKey.trim() && publicKey !== (status?.publicKey ?? "")
          ? { publicKey: publicKey.trim() }
          : {}),
        ...(privateKey.trim() ? { privateKey: privateKey.trim() } : {}),
      });
      setStatus(s);
      setProvider(s.provider);
      setPublicKey(s.publicKey ?? "");
      setPrivateKey("");
      setUrlEndpoint(s.urlEndpoint ?? "");
      setFolder(s.folder ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  async function clearPrivateKey() {
    setSaving(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateMediaConfig({
        clearPrivateKey: true,
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
            Media storage
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Choose where media field uploads go for{" "}
            <strong>this website only</strong>. Local disk is the default.
            ImageKit stores and delivers images via their CDN when configured.
            ImageKit uploads are auto-optimized (max 2560px on the long edge,
            quality 80) so large camera files are safe to upload (up to 25MB).
          </p>
          <div style={{ marginBottom: "1rem" }}>
            Status:{" "}
            <span
              className="badge"
              data-status={status?.configured ? "published" : "draft"}
            >
              {status?.provider === "imagekit"
                ? status.imagekitConfigured
                  ? "imagekit ready"
                  : "imagekit incomplete"
                : "local disk"}
            </span>{" "}
            <span className="muted">
              · source {status?.source ?? "…"}
              {status?.privateKeyPreview
                ? ` · private ${status.privateKeyPreview}`
                : ""}
            </span>
          </div>
          <form className="form" onSubmit={saveConfig}>
            <div className="field">
              <label htmlFor="mediaProvider">Provider</label>
              <select
                id="mediaProvider"
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as MediaProvider)
                }
              >
                <option value="local">Local disk (default)</option>
                <option value="imagekit">ImageKit</option>
              </select>
            </div>

            {provider === "imagekit" && (
              <>
                <div className="field">
                  <label htmlFor="urlEndpoint">URL endpoint</label>
                  <input
                    id="urlEndpoint"
                    value={urlEndpoint}
                    onChange={(e) => setUrlEndpoint(e.target.value)}
                    placeholder="https://ik.imagekit.io/your_id"
                  />
                </div>
                <div className="field">
                  <label htmlFor="publicKey">Public key</label>
                  <input
                    id="publicKey"
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder={
                      status?.publicKeyConfigured
                        ? "Leave blank to keep current key"
                        : "public_…"
                    }
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="privateKey">Private key</label>
                  <input
                    id="privateKey"
                    type="password"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder={
                      status?.privateKeyConfigured
                        ? "Leave blank to keep current key"
                        : "private_…"
                    }
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="folder">Folder (optional)</label>
                  <input
                    id="folder"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    placeholder="aurora"
                  />
                  <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                    Uploads go under{" "}
                    <code>
                      /{folder.trim() || "…"}/{`<websiteId>`}/
                    </code>{" "}
                    in ImageKit Media Library.
                  </p>
                </div>
              </>
            )}

            <div className="actions">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save config"}
              </button>
              {provider === "imagekit" && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={saving || !status?.privateKeyConfigured}
                  onClick={() => void clearPrivateKey()}
                >
                  Clear private key
                </button>
              )}
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
              data-status={status?.configured ? "published" : "draft"}
            >
              {status?.provider === "imagekit"
                ? status.imagekitConfigured
                  ? "imagekit ready"
                  : "imagekit incomplete"
                : "local disk"}
            </span>
            {" · "}
            Only website admins can change media storage settings.
          </p>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
