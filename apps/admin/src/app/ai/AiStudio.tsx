"use client";

import type { AiMacro, AiStatus } from "@cms/shared";
import { AI_MACROS_MAX } from "@cms/shared";
import { useEffect, useRef, useState } from "react";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";
import { formatEur } from "@/lib/websiteCosts";

/** Provider, instructions, and macros — chat lives in the studio AI dock. */
export function AiStudio() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [costPerTokenEur, setCostPerTokenEur] = useState("0.000012");
  const [instructions, setInstructions] = useState("");
  const [macros, setMacros] = useState<AiMacro[]>([]);
  const [newMacroName, setNewMacroName] = useState("");
  const [newMacroPrompt, setNewMacroPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [savingMacros, setSavingMacros] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const autoLoadedModels = useRef(false);

  async function refreshStatus() {
    const s = await getBrowserAdminClient().getAiStatus();
    setStatus(s);
    setBaseUrl(s.baseUrl ?? "");
    setModel(s.model ?? "");
    setCostPerTokenEur(
      s.costPerTokenEur != null ? String(s.costPerTokenEur) : "0.000012",
    );
    setInstructions(s.instructions ?? "");
    setMacros(s.macros ?? []);
    return s;
  }

  async function loadModels(options?: {
    baseUrl?: string;
    apiKey?: string;
    keepSelection?: string;
  }) {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await getBrowserAdminClient().listAiModels({
        ...(options?.baseUrl?.trim()
          ? { baseUrl: options.baseUrl.trim() }
          : {}),
        ...(options?.apiKey?.trim() ? { apiKey: options.apiKey.trim() } : {}),
      });
      const ids = res.models.map((m) => m.id);
      const keep = options?.keepSelection?.trim();
      if (keep && !ids.includes(keep)) ids.unshift(keep);
      setModels(ids);
      if (keep && ids.includes(keep)) setModel(keep);
      else if (ids.length > 0) {
        setModel((current) => (ids.includes(current) ? current : ids[0]!));
      }
    } catch (err) {
      setModels([]);
      setModelsError(
        err instanceof Error ? err.message : "Failed to load models",
      );
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    setIsAdmin(getStoredUser()?.role === "admin");
    refreshStatus()
      .then((s) => {
        if (
          getStoredUser()?.role === "admin" &&
          s.baseUrl &&
          s.apiKeyConfigured &&
          !autoLoadedModels.current
        ) {
          autoLoadedModels.current = true;
          return loadModels({
            baseUrl: s.baseUrl ?? undefined,
            keepSelection: s.model ?? undefined,
          });
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load AI status"),
      );
  }, []);

  async function saveProvider(e: React.FormEvent) {
    e.preventDefault();
    setSavingProvider(true);
    setError(null);
    try {
      const cost = Number(costPerTokenEur);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new Error("Cost per token must be a non-negative number");
      }
      const s = await getBrowserAdminClient().updateAiConfig({
        baseUrl,
        model,
        costPerTokenEur: cost,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setStatus(s);
      setApiKey("");
      setModel(s.model ?? "");
      setCostPerTokenEur(String(s.costPerTokenEur));
      setMacros(s.macros ?? []);
      if (s.baseUrl && s.apiKeyConfigured) {
        await loadModels({
          baseUrl: s.baseUrl,
          keepSelection: s.model ?? undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSavingProvider(false);
    }
  }

  async function saveInstructions(e: React.FormEvent) {
    e.preventDefault();
    setSavingInstructions(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateAiConfig({
        instructions: instructions.trim() ? instructions : null,
      });
      setStatus(s);
      setInstructions(s.instructions ?? "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save instructions",
      );
    } finally {
      setSavingInstructions(false);
    }
  }

  async function saveMacros(next: AiMacro[]) {
    setSavingMacros(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateAiConfig({ macros: next });
      setStatus(s);
      setMacros(s.macros ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save macros");
    } finally {
      setSavingMacros(false);
    }
  }

  async function addMacro(e: React.FormEvent) {
    e.preventDefault();
    const name = newMacroName.trim();
    const prompt = newMacroPrompt.trim();
    if (!name || !prompt) {
      setError("Macro name and prompt are required");
      return;
    }
    if (macros.length >= AI_MACROS_MAX) {
      setError(`At most ${AI_MACROS_MAX} custom macros are allowed`);
      return;
    }
    const next = [
      ...macros,
      { id: crypto.randomUUID(), name, prompt },
    ];
    await saveMacros(next);
    setNewMacroName("");
    setNewMacroPrompt("");
  }

  async function clearKey() {
    setSavingProvider(true);
    setError(null);
    try {
      const s = await getBrowserAdminClient().updateAiConfig({
        clearApiKey: true,
      });
      setStatus(s);
      setModels([]);
      setModelsError(null);
      autoLoadedModels.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setSavingProvider(false);
    }
  }

  const usage = status?.usage;
  const per1k =
    status?.costPerTokenEur != null
      ? status.costPerTokenEur * 1000
      : null;
  const busy = savingProvider || savingInstructions || savingMacros;
  const canListModels =
    Boolean(baseUrl.trim()) &&
    (Boolean(apiKey.trim()) || Boolean(status?.apiKeyConfigured));
  const modelOptions =
    model && !models.includes(model) ? [model, ...models] : models;

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {usage && (
        <div className="panel">
          <h2
            style={{
              marginTop: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 500,
            }}
          >
            Usage this month
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Recorded from AI chat and entry tools for this website (UTC month).
          </p>
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Total tokens
              </div>
              <strong>{usage.totalTokens.toLocaleString("nl-NL")}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Prompt / completion
              </div>
              <strong>
                {usage.promptTokens.toLocaleString("nl-NL")} /{" "}
                {usage.completionTokens.toLocaleString("nl-NL")}
              </strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                API calls
              </div>
              <strong>{usage.callCount.toLocaleString("nl-NL")}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Estimated cost
              </div>
              <strong>{formatEur(usage.estimatedCostEur)}</strong>
            </div>
          </div>
        </div>
      )}

      {isAdmin ? (
        <>
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
              <strong>this website only</strong>. Day-to-day AI chat lives in
              the right-hand assistant dock on every studio page.
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
            <form className="form" onSubmit={saveProvider}>
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
              <div className="field">
                <label htmlFor="model">Model</label>
                <div
                  style={{
                    display: "grid",
                    gap: "0.5rem",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "start",
                  }}
                >
                  <select
                    id="model"
                    value={modelOptions.includes(model) ? model : ""}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={loadingModels || modelOptions.length === 0}
                  >
                    {modelOptions.length === 0 ? (
                      <option value="">
                        {loadingModels
                          ? "Loading models…"
                          : "Refresh models to choose"}
                      </option>
                    ) : (
                      modelOptions.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy || loadingModels || !canListModels}
                    onClick={() =>
                      void loadModels({
                        baseUrl,
                        apiKey,
                        keepSelection: model,
                      })
                    }
                  >
                    {loadingModels ? "Loading…" : "Refresh models"}
                  </button>
                </div>
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  Models come from{" "}
                  <code>{baseUrl.trim() || "…"}/models</code> using the API key
                  above (or the stored key).
                </p>
                {modelsError && (
                  <p style={{ color: "var(--danger)", margin: "0.35rem 0 0" }}>
                    {modelsError}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="costPerTokenEur">Cost per token (EUR)</label>
                <input
                  id="costPerTokenEur"
                  type="number"
                  step="any"
                  min="0"
                  value={costPerTokenEur}
                  onChange={(e) => setCostPerTokenEur(e.target.value)}
                  placeholder="0.000012"
                />
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  Used on the dashboard for estimated AI cost.
                  {per1k != null
                    ? ` ≈ ${formatEur(per1k)} per 1.000 tokens.`
                    : null}
                </p>
              </div>
              <div className="actions">
                <button className="btn" type="submit" disabled={busy}>
                  {savingProvider ? "Saving…" : "Save provider"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy || !status?.apiKeyConfigured}
                  onClick={() => void clearKey()}
                >
                  Clear stored key
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <h2
              style={{
                marginTop: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 500,
              }}
            >
              Website AI instructions
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Standing instructions for this website — tone, language, brand
              rules, what to avoid. Appended to every AI chat, Write, Optimize,
              and custom macro.
            </p>
            <form className="form" onSubmit={saveInstructions}>
              <div className="field">
                <label htmlFor="aiInstructions">Instructions</label>
                <textarea
                  id="aiInstructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={8}
                  maxLength={8000}
                  placeholder="Tone, language, brand rules, what to avoid…"
                />
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  {instructions.length}/8000
                </p>
              </div>
              <div className="actions">
                <button className="btn" type="submit" disabled={busy}>
                  {savingInstructions ? "Saving…" : "Save instructions"}
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <h2
              style={{
                marginTop: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 500,
              }}
            >
              Custom macros
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Extra one-click actions next to built-in <strong>Write</strong>{" "}
              and <strong>Optimize</strong> in the AI dock (and entry shortcuts).
              Each macro sends its prompt when an entry is open.{" "}
              {macros.length}/{AI_MACROS_MAX}
            </p>

            {macros.length > 0 ? (
              <ul className="ai-macro-list">
                {macros.map((m) => (
                  <li key={m.id} className="ai-macro-item">
                    <div>
                      <strong>{m.name}</strong>
                      <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                        {m.prompt}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        void saveMacros(macros.filter((x) => x.id !== m.id))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No custom macros yet.</p>
            )}

            <form className="form" onSubmit={(e) => void addMacro(e)}>
              <div className="field">
                <label htmlFor="macroName">Name</label>
                <input
                  id="macroName"
                  value={newMacroName}
                  onChange={(e) => setNewMacroName(e.target.value)}
                  placeholder="e.g. SEO titles"
                  maxLength={40}
                  disabled={macros.length >= AI_MACROS_MAX}
                />
              </div>
              <div className="field">
                <label htmlFor="macroPrompt">Prompt</label>
                <textarea
                  id="macroPrompt"
                  value={newMacroPrompt}
                  onChange={(e) => setNewMacroPrompt(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Instruction sent when the macro button is clicked…"
                  disabled={macros.length >= AI_MACROS_MAX}
                />
              </div>
              <div className="actions">
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || macros.length >= AI_MACROS_MAX}
                >
                  {savingMacros ? "Saving…" : "Add macro"}
                </button>
              </div>
            </form>
          </div>

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </>
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
            can change AI provider settings, instructions, and macros.
          </p>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
