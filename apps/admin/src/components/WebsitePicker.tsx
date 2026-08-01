"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { WebsiteMembership } from "@cms/shared";
import { createCmsClient } from "@cms/shared";
import { getStoredToken, storeSession, syncSessionCookie } from "@/lib/auth";

function client() {
  return createCmsClient({
    baseUrl: process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000",
    token: getStoredToken(),
  });
}

export function WebsitePicker() {
  const router = useRouter();
  const [items, setItems] = useState<WebsiteMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    void (async () => {
      try {
        const list = await client().listWebsites();
        setItems(list);
        if (list.length === 1) {
          const res = await client().selectWebsite({ websiteId: list[0].id });
          storeSession(res.token, res.user);
          await syncSessionCookie(res.token);
          window.location.assign("/");
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load websites");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function select(websiteId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await client().selectWebsite({ websiteId });
      storeSession(res.token, res.user);
      await syncSessionCookie(res.token);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select website");
    } finally {
      setPending(false);
    }
  }

  async function createWebsite(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await client().createWebsite({ name: newName.trim() });
      storeSession(res.token, res.user);
      await syncSessionCookie(res.token);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create website");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <div className="auth-shell muted">Loading websites…</div>;
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem", width: "min(480px, 100%)" }}>
      <div className="panel">
        <h2
          style={{
            marginTop: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 500,
          }}
        >
          Choose a website
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Select which website to manage in the studio.
        </p>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {items.map((w) => (
            <button
              key={w.id}
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => void select(w.id)}
              style={{ justifyContent: "space-between", width: "100%" }}
            >
              <span>{w.name}</span>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {w.role}
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="muted">No websites yet — create one below.</p>
          )}
        </div>
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
          New website
        </h2>
        <form className="form" onSubmit={createWebsite}>
          <div className="field">
            <label htmlFor="new-site">Name</label>
            <input
              id="new-site"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={pending}>
            Create & open
          </button>
        </form>
      </div>
    </div>
  );
}
