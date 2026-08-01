"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LocalizationMode } from "@cms/shared";
import { getBrowserAdminClient } from "@/lib/auth";

export function CreateContentTypeForm() {
  const router = useRouter();
  const [apiId, setApiId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [localizationMode, setLocalizationMode] =
    useState<LocalizationMode>("explicit");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().createContentType({
        apiId,
        name,
        description: description || undefined,
        localizationMode,
      });
      setApiId("");
      setName("");
      setDescription("");
      setLocalizationMode("explicit");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Product"
        />
      </div>
      <div className="field">
        <label htmlFor="apiId">API ID</label>
        <input
          id="apiId"
          value={apiId}
          onChange={(e) => setApiId(e.target.value)}
          required
          pattern="^[a-z][a-z0-9_]*$"
          placeholder="product"
        />
      </div>
      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="field">
        <label htmlFor="localizationMode">Localization</label>
        <select
          id="localizationMode"
          value={localizationMode}
          onChange={(e) =>
            setLocalizationMode(e.target.value as LocalizationMode)
          }
        >
          <option value="explicit">Explicit languages only</option>
          <option value="all_locales">All site languages</option>
        </select>
      </div>
      {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create type"}
      </button>
    </form>
  );
}
