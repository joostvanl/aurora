"use client";

import { useEffect, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export function TokensManager() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const items = await getBrowserAdminClient().listApiTokens();
    setTokens(items as TokenRow[]);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load tokens"),
    );
  }, []);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const days = expiresInDays.trim()
        ? Number(expiresInDays)
        : undefined;
      const res = await getBrowserAdminClient().createApiToken({
        name: name.trim(),
        ...(days && Number.isFinite(days) ? { expiresInDays: days } : {}),
      });
      setCreatedSecret(res.token);
      setName("");
      setExpiresInDays("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API token?")) return;
    setPending(true);
    try {
      await getBrowserAdminClient().deleteApiToken(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {createdSecret && (
        <div className="panel" style={{ borderColor: "var(--accent)" }}>
          <p style={{ marginTop: 0 }}>
            Copy this token now — it will not be shown again:
          </p>
          <code style={{ wordBreak: "break-all" }}>{createdSecret}</code>
        </div>
      )}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <code>{t.prefix}…</code>
                </td>
                <td className="muted">
                  {t.expiresAt
                    ? new Date(t.expiresAt).toLocaleDateString()
                    : "never"}
                </td>
                <td>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={pending}
                    onClick={() => void revoke(t.id)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No API tokens yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && (
          <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>{error}</p>
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
          New token
        </h2>
        <form className="form" onSubmit={createToken}>
          <div className="field">
            <label htmlFor="tok-name">Name</label>
            <input
              id="tok-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="CI / agent"
            />
          </div>
          <div className="field">
            <label htmlFor="tok-exp">Expires in days (optional)</label>
            <input
              id="tok-exp"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="90"
            />
          </div>
          <button className="btn" type="submit" disabled={pending}>
            Create token
          </button>
        </form>
      </div>
    </div>
  );
}
