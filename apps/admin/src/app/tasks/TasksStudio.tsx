"use client";

import type {
  AiMacro,
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskFrequency,
} from "@cms/shared";
import { useEffect, useMemo, useState } from "react";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";

const WEEKDAYS = [
  { value: 0, label: "Zondag" },
  { value: 1, label: "Maandag" },
  { value: 2, label: "Dinsdag" },
  { value: 3, label: "Woensdag" },
  { value: 4, label: "Donderdag" },
  { value: 5, label: "Vrijdag" },
  { value: 6, label: "Zaterdag" },
] as const;

const FREQUENCIES: { value: ScheduledTaskFrequency; label: string }[] = [
  { value: "once", label: "Eenmalig" },
  { value: "daily", label: "Dagelijks" },
  { value: "weekly", label: "Wekelijks" },
  { value: "monthly", label: "Maandelijks" },
];

type FormState = {
  name: string;
  prompt: string;
  macroId: string;
  enabled: boolean;
  allowPublish: boolean;
  maxTokens: string;
  maxToolCalls: string;
  frequency: ScheduledTaskFrequency;
  timeOfDay: string;
  timeZone: string;
  byWeekday: number;
  byMonthDay: number;
  startDate: string;
  endDate: string;
};

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyForm(): FormState {
  return {
    name: "",
    prompt: "",
    macroId: "",
    enabled: true,
    allowPublish: false,
    maxTokens: "",
    maxToolCalls: "",
    frequency: "daily",
    timeOfDay: "09:00",
    timeZone: "Europe/Amsterdam",
    byWeekday: 1,
    byMonthDay: 1,
    startDate: todayLocalDate(),
    endDate: "",
  };
}

function toIsoStart(date: string): string {
  return new Date(`${date}T00:00:00.000`).toISOString();
}

function toIsoEnd(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function dateInputFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formFromTask(task: ScheduledTask): FormState {
  return {
    name: task.name,
    prompt: task.prompt,
    macroId: task.macroId ?? "",
    enabled: task.enabled,
    allowPublish: task.allowPublish,
    maxTokens: task.maxTokens != null ? String(task.maxTokens) : "",
    maxToolCalls: task.maxToolCalls != null ? String(task.maxToolCalls) : "",
    frequency: task.frequency,
    timeOfDay: task.timeOfDay,
    timeZone: task.timeZone,
    byWeekday: task.byWeekday ?? 1,
    byMonthDay: task.byMonthDay ?? 1,
    startDate: dateInputFromIso(task.startAt) || todayLocalDate(),
    endDate: dateInputFromIso(task.endAt),
  };
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function frequencySummary(task: ScheduledTask): string {
  const time = `${task.timeOfDay} (${task.timeZone})`;
  if (task.frequency === "once") return `Eenmalig om ${time}`;
  if (task.frequency === "daily") return `Dagelijks om ${time}`;
  if (task.frequency === "weekly") {
    const day =
      WEEKDAYS.find((d) => d.value === task.byWeekday)?.label ??
      `dag ${task.byWeekday}`;
    return `Wekelijks op ${day} om ${time}`;
  }
  return `Maandelijks op dag ${task.byMonthDay ?? "?"} om ${time}`;
}

function parseOptionalPositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Limieten moeten lege velden of positieve gehele getallen zijn.");
  }
  return n;
}

function buildPayload(form: FormState): CreateScheduledTaskInput {
  const payload: CreateScheduledTaskInput = {
    name: form.name.trim(),
    enabled: form.enabled,
    allowPublish: form.allowPublish,
    maxTokens: parseOptionalPositiveInt(form.maxTokens),
    maxToolCalls: parseOptionalPositiveInt(form.maxToolCalls),
    frequency: form.frequency,
    timeOfDay: form.timeOfDay,
    timeZone: form.timeZone.trim() || "Europe/Amsterdam",
    startAt: toIsoStart(form.startDate),
    prompt: form.prompt.trim() || undefined,
    macroId: form.macroId.trim() || undefined,
    endAt: form.endDate ? toIsoEnd(form.endDate) : null,
  };
  if (form.frequency === "weekly") {
    payload.byWeekday = form.byWeekday;
  }
  if (form.frequency === "monthly") {
    payload.byMonthDay = form.byMonthDay;
  }
  return payload;
}

export function TasksStudio() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [macros, setMacros] = useState<AiMacro[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  async function load() {
    const client = getBrowserAdminClient();
    const [list, ai] = await Promise.all([
      client.listScheduledTasks(),
      client.getAiStatus().catch(() => null),
    ]);
    setTasks(list.items);
    setMacros(ai?.macros ?? []);
    setLoaded(true);
    if (selectedId) {
      const still = list.items.find((t) => t.id === selectedId);
      if (still) setForm(formFromTask(still));
      else {
        setSelectedId(null);
        setForm(emptyForm());
      }
    }
  }

  useEffect(() => {
    setIsAdmin(getStoredUser()?.role === "admin");
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Taken laden mislukt"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  function selectTask(task: ScheduledTask) {
    setSelectedId(task.id);
    setForm(formFromTask(task));
    setError(null);
  }

  function startCreate() {
    setSelectedId(null);
    setForm(emptyForm());
    setError(null);
  }

  function onMacroPick(macroId: string) {
    const macro = macros.find((m) => m.id === macroId);
    setForm((f) => ({
      ...f,
      macroId,
      prompt: macro ? macro.prompt : f.prompt,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setPending(true);
    setError(null);
    try {
      const payload = buildPayload(form);
      const client = getBrowserAdminClient();
      if (selectedId) {
        // Editing prompt freely: clear macro link if prompt diverged from macro text.
        const macro = macros.find((m) => m.id === form.macroId);
        const macroId =
          form.macroId && macro && form.prompt.trim() === macro.prompt
            ? form.macroId
            : form.macroId && !form.prompt.trim()
              ? form.macroId
              : form.macroId && macro && form.prompt.trim() !== macro.prompt
                ? null
                : form.macroId || null;
        await client.updateScheduledTask(selectedId, {
          ...payload,
          macroId,
          prompt: form.prompt.trim(),
        });
      } else {
        const created = await client.createScheduledTask(payload);
        setSelectedId(created.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!selectedId || !isAdmin) return;
    if (!confirm("Deze taak verwijderen?")) return;
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().deleteScheduledTask(selectedId);
      setSelectedId(null);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verwijderen mislukt");
    } finally {
      setPending(false);
    }
  }

  async function runNow() {
    if (!selectedId || !isAdmin) return;
    setPending(true);
    setError(null);
    try {
      const res = await getBrowserAdminClient().runScheduledTaskNow(selectedId);
      setTasks((prev) =>
        prev.map((t) => (t.id === res.task.id ? { ...t, ...res.task } : t)),
      );
      setForm(formFromTask(res.task));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu uitvoeren mislukt");
    } finally {
      setPending(false);
    }
  }

  async function toggleEnabled(task: ScheduledTask) {
    if (!isAdmin) return;
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().updateScheduledTask(task.id, {
        enabled: !task.enabled,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bijwerken mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {!isAdmin && (
        <p className="muted" style={{ margin: 0 }}>
          Je kunt taken bekijken. Alleen admins kunnen taken wijzigen of
          uitvoeren.
        </p>
      )}

      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "0.75rem",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 500,
            }}
          >
            Geplande taken
          </h2>
          {isAdmin && (
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={startCreate}
            >
              Nieuwe taak
            </button>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Schema</th>
              <th>Volgende</th>
              <th>Status</th>
              <th>Actief</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                style={{
                  cursor: "pointer",
                  background:
                    task.id === selectedId
                      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : undefined,
                }}
                onClick={() => selectTask(task)}
              >
                <td>
                  <strong>{task.name}</strong>
                </td>
                <td className="muted">{frequencySummary(task)}</td>
                <td className="muted">{formatWhen(task.nextRunAt)}</td>
                <td>
                  <span
                    className="badge"
                    data-status={
                      task.lastStatus === "ok"
                        ? "published"
                        : task.lastStatus === "error"
                          ? "draft"
                          : undefined
                    }
                  >
                    {task.lastStatus ?? "—"}
                  </span>
                </td>
                <td>
                  {isAdmin ? (
                    <button
                      className="btn"
                      type="button"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleEnabled(task);
                      }}
                    >
                      {task.enabled ? "Aan" : "Uit"}
                    </button>
                  ) : (
                    <span className="muted">
                      {task.enabled ? "Aan" : "Uit"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {loaded && tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Nog geen taken. Maak een taak om de AI op schema te laten
                  werken.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && (
          <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>
            {error}
          </p>
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
          {selectedId ? "Taak bewerken" : "Nieuwe taak"}
        </h2>
        <form className="form" onSubmit={(e) => void save(e)}>
          <div className="field">
            <label htmlFor="task-name">Naam</label>
            <input
              id="task-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              disabled={!isAdmin}
              placeholder="Bijv. Ochtend nieuws-draft"
            />
          </div>

          <div className="field">
            <label htmlFor="task-macro">Macro (optioneel)</label>
            <select
              id="task-macro"
              value={form.macroId}
              disabled={!isAdmin}
              onChange={(e) => onMacroPick(e.target.value)}
            >
              <option value="">— Vrije prompt —</option>
              {macros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              Een macro vult de prompt voor. Daarna kun je de tekst vrij
              aanpassen.
            </p>
          </div>

          <div className="field">
            <label htmlFor="task-prompt">Prompt</label>
            <textarea
              id="task-prompt"
              rows={6}
              value={form.prompt}
              disabled={!isAdmin}
              onChange={(e) =>
                setForm((f) => ({ ...f, prompt: e.target.value }))
              }
              placeholder="Beschrijf wat de AI-agent moet doen…"
              required={!form.macroId}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
              gap: "0.75rem",
            }}
          >
            <div className="field">
              <label htmlFor="task-freq">Frequentie</label>
              <select
                id="task-freq"
                value={form.frequency}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    frequency: e.target.value as ScheduledTaskFrequency,
                  }))
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-tod">Tijdstip</label>
              <input
                id="task-tod"
                type="time"
                value={form.timeOfDay}
                disabled={!isAdmin}
                required
                onChange={(e) =>
                  setForm((f) => ({ ...f, timeOfDay: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="task-tz">Tijdzone</label>
              <input
                id="task-tz"
                value={form.timeZone}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, timeZone: e.target.value }))
                }
                placeholder="Europe/Amsterdam"
              />
            </div>
          </div>

          {form.frequency === "weekly" && (
            <div className="field">
              <label htmlFor="task-weekday">Weekdag</label>
              <select
                id="task-weekday"
                value={form.byWeekday}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    byWeekday: Number(e.target.value),
                  }))
                }
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.frequency === "monthly" && (
            <div className="field">
              <label htmlFor="task-monthday">Dag van de maand</label>
              <input
                id="task-monthday"
                type="number"
                min={1}
                max={31}
                value={form.byMonthDay}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    byMonthDay: Number(e.target.value),
                  }))
                }
              />
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
              gap: "0.75rem",
            }}
          >
            <div className="field">
              <label htmlFor="task-start">Startdatum</label>
              <input
                id="task-start"
                type="date"
                value={form.startDate}
                disabled={!isAdmin}
                required
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="task-end">Einddatum (optioneel)</label>
              <input
                id="task-end"
                type="date"
                value={form.endDate}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endDate: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="field">
            <label
              htmlFor="task-enabled"
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
              <input
                id="task-enabled"
                type="checkbox"
                checked={form.enabled}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, enabled: e.target.checked }))
                }
              />
              Actief
            </label>
          </div>

          <div className="field">
            <label
              htmlFor="task-allow-publish"
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
              <input
                id="task-allow-publish"
                type="checkbox"
                checked={form.allowPublish}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, allowPublish: e.target.checked }))
                }
              />
              Automatisch publiceren
            </label>
            {form.allowPublish ? (
              <p
                style={{
                  color: "var(--danger)",
                  margin: "0.5rem 0 0",
                  fontSize: "0.9rem",
                }}
              >
                Let op: bij een geplande run kan de AI-agent content direct
                publiceren zonder menselijke controle. Gebruik dit alleen als
                dat bewust gewenst is.
              </p>
            ) : (
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                Standaard blijven wijzigingen concept (draft).
              </p>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
            }}
          >
            <div className="field">
              <label htmlFor="task-max-tokens">Max tokens (optioneel)</label>
              <input
                id="task-max-tokens"
                type="number"
                min={1}
                placeholder="Geen limiet"
                value={form.maxTokens}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxTokens: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="task-max-tools">Max tool calls (optioneel)</label>
              <input
                id="task-max-tools"
                type="number"
                min={1}
                placeholder="Agent-default"
                value={form.maxToolCalls}
                disabled={!isAdmin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxToolCalls: e.target.value }))
                }
              />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Soft caps per run. Leeg = geen extra limiet. Gebruik recente runs om
            limieten te tunen.
          </p>

          {isAdmin && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button className="btn" type="submit" disabled={pending}>
                {selectedId ? "Opslaan" : "Aanmaken"}
              </button>
              {selectedId && (
                <>
                  <button
                    className="btn"
                    type="button"
                    disabled={pending}
                    onClick={() => void runNow()}
                  >
                    Nu uitvoeren
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={pending}
                    onClick={() => void remove()}
                  >
                    Verwijderen
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      </div>

      {selected && (
        <div className="panel">
          <h2
            style={{
              marginTop: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 500,
            }}
          >
            Laatste status
          </h2>
          <p style={{ marginTop: 0 }}>
            Volgende run: <strong>{formatWhen(selected.nextRunAt)}</strong>
            <br />
            Laatste run: <strong>{formatWhen(selected.lastRunAt)}</strong>
            <br />
            Status: <strong>{selected.lastStatus ?? "—"}</strong>
          </p>
          {selected.lastError && (
            <p style={{ color: "var(--danger)" }}>{selected.lastError}</p>
          )}
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: "1.05rem",
            }}
          >
            Recente runs
          </h3>
          {(selected.recentRuns?.length ?? 0) === 0 ? (
            <p className="muted">Nog geen runs.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Gestart</th>
                  <th>Ok</th>
                  <th>Tokens</th>
                  <th>Tools</th>
                  <th>Stop</th>
                  <th>Samenvatting</th>
                </tr>
              </thead>
              <tbody>
                {selected.recentRuns!.map((run) => (
                  <tr key={run.id}>
                    <td className="muted">{formatWhen(run.startedAt)}</td>
                    <td>{run.ok ? "ja" : "nee"}</td>
                    <td className="muted">{run.totalTokens}</td>
                    <td className="muted">
                      {run.toolCallCount}
                      {run.uniqueToolCount
                        ? ` (${run.uniqueToolCount} uniek)`
                        : ""}
                    </td>
                    <td className="muted">{run.stoppedReason ?? "—"}</td>
                    <td>{run.summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
