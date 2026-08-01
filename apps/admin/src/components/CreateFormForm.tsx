"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";

export function CreateFormForm() {
  const router = useRouter();
  const [apiId, setApiId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const form = await getBrowserAdminClient().createForm({ apiId, name });
      router.push(`/forms/${form.apiId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create form");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="form-name">Name</label>
        <input
          id="form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="form-api">API ID</label>
        <input
          id="form-api"
          value={apiId}
          onChange={(e) => setApiId(e.target.value)}
          pattern="^[a-z][a-z0-9_]*$"
          required
        />
      </div>
      {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create form"}
      </button>
    </form>
  );
}
