/** Server-side context budgets for the AI agent (token cost control). */

import { fieldDigest } from "../lib/fieldHash.js";

export const DEFAULT_AI_HISTORY_MAX = 10;
export const DEFAULT_AI_TOOL_RESULT_MAX_CHARS = 6_000;
export const DEFAULT_AI_KNOWLEDGE_MAX_CHARS = 6_000;
export const DEFAULT_AI_KNOWLEDGE_MAX_CHARS_FOCUSED = 12_000;
export const DEFAULT_AI_INDEX_PER_TYPE = 15;
export const DEFAULT_AI_INDEX_PER_TYPE_FOCUSED = 40;

/** Tools whose payload must never be sliced (hard fail already applied upstream). */
export const NEVER_SLICE_TOOL_RESULTS = new Set(["get_entry_field"]);

function envInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function resolveHistoryMax(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return envInt(env, "CMS_AI_HISTORY_MAX", DEFAULT_AI_HISTORY_MAX, 1, 40);
}

export function resolveToolResultMaxChars(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return envInt(
    env,
    "CMS_AI_TOOL_RESULT_MAX_CHARS",
    DEFAULT_AI_TOOL_RESULT_MAX_CHARS,
    500,
    50_000,
  );
}

export function resolveKnowledgeMaxChars(
  focused: boolean,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fallback = focused
    ? DEFAULT_AI_KNOWLEDGE_MAX_CHARS_FOCUSED
    : DEFAULT_AI_KNOWLEDGE_MAX_CHARS;
  return envInt(env, "CMS_AI_KNOWLEDGE_MAX_CHARS", fallback, 1_000, 40_000);
}

export function resolveIndexPerType(
  focused: boolean,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fallback = focused
    ? DEFAULT_AI_INDEX_PER_TYPE_FOCUSED
    : DEFAULT_AI_INDEX_PER_TYPE;
  return envInt(env, "CMS_AI_INDEX_PER_TYPE", fallback, 5, 100);
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function omittedStub(apiId: string, value: string) {
  const digest = fieldDigest(value);
  return {
    apiId,
    length: digest.length,
    sha256: digest.sha256,
    omitted: true as const,
  };
}

function fieldsRecord(data: unknown): Record<string, unknown> | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const rec = data as Record<string, unknown>;
  if (
    rec.fields !== null &&
    typeof rec.fields === "object" &&
    !Array.isArray(rec.fields)
  ) {
    return rec.fields as Record<string, unknown>;
  }
  return rec;
}

/**
 * When get_entry (or any FlatEntry-shaped result) overflows the budget,
 * omit large string fields instead of slicing JSON.
 */
function compactEntryToolResult(
  result: { name: string; ok: boolean; summary: string; data?: unknown; code?: string },
  maxChars: number,
): string {
  const data =
    result.data !== undefined
      ? (structuredClone(result.data) as unknown)
      : undefined;
  const fields = fieldsRecord(data);
  const stringFields: Array<{ apiId: string; value: string }> = [];
  if (fields) {
    for (const [apiId, value] of Object.entries(fields)) {
      if (typeof value === "string") stringFields.push({ apiId, value });
    }
    stringFields.sort((a, b) => b.value.length - a.value.length);
  }

  const summary = `${truncateText(result.summary, 200)}. Large string fields omitted — use get_entry_field.`;
  const payload = {
    name: result.name,
    ok: result.ok,
    summary,
    dataTruncated: true as const,
    ...(result.code ? { code: result.code } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  for (const { apiId, value } of stringFields) {
    if (JSON.stringify(payload).length <= maxChars) break;
    if (fields) fields[apiId] = omittedStub(apiId, value);
  }

  let out = JSON.stringify(payload);
  if (out.length > maxChars) {
    out = JSON.stringify({
      name: result.name,
      ok: result.ok,
      summary,
      dataTruncated: true,
      data: {
        omitted: true,
        reason: "entry exceeds context budget; use get_entry_field",
      },
    });
  }
  return out;
}

const EXTERNAL_SOURCE_TOOLS = new Set([
  "call_external_source",
  "list_external_source_tools",
]);

const COMPACT_ITEM_KEYS = [
  "id",
  "sourceId",
  "name",
  "shortName",
  "slug",
  "category",
  "genderCategory",
  "ageCategory",
  "teamNumber",
  "type",
  "clubId",
  "teamId",
  "poule",
  "pouleId",
  "season",
  "sourcePath",
] as const;

function stripSources(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSources);
  if (!value || typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rec)) {
    if (key === "sources" && Array.isArray(child)) {
      out.sourcesOmitted = child.length;
      continue;
    }
    out[key] = stripSources(child);
  }
  return out;
}

function findItemArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (Array.isArray(rec.data)) return rec.data;
  const nested = rec.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    for (const key of ["items", "teams", "matches"]) {
      if (Array.isArray(inner[key])) return inner[key] as unknown[];
    }
  }
  for (const key of ["items", "teams", "matches"]) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return null;
}

function firstPouleId(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const league = value.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return (item as Record<string, unknown>).type === "league";
  });
  const pick = league ?? value[0];
  if (!pick || typeof pick !== "object" || Array.isArray(pick)) return undefined;
  const pouleId = (pick as Record<string, unknown>).pouleId;
  return typeof pouleId === "string" ? pouleId : undefined;
}

function compactItem(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of COMPACT_ITEM_KEYS) {
    if (rec[key] !== undefined) out[key] = rec[key];
  }
  if (out.pouleId === undefined) {
    const pouleId = firstPouleId(rec.competitions);
    if (pouleId) out.pouleId = pouleId;
  }
  return Object.keys(out).length ? out : value;
}

/** Always-on index so later rows (HR 1) are not dropped when fat rows are sliced. */
function indexItem(value: unknown, tight = false): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rec = value as Record<string, unknown>;
  const keys = tight
    ? (["shortName", "season", "sourcePath"] as const)
    : (["shortName", "name", "season", "sourcePath"] as const);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof rec[key] === "string" && rec[key]) out[key] = rec[key];
  }
  return Object.keys(out).length ? out : value;
}

function replaceItemArray(data: unknown, items: unknown[]): unknown {
  if (Array.isArray(data)) return items;
  if (!data || typeof data !== "object") return { items };
  const clone = structuredClone(data) as Record<string, unknown>;
  if (Array.isArray(clone.data)) {
    clone.data = items;
    return clone;
  }
  const nested = clone.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    for (const key of ["items", "teams", "matches"]) {
      if (Array.isArray(inner[key])) {
        inner[key] = items;
        return clone;
      }
    }
  }
  for (const key of ["items", "teams", "matches"]) {
    if (Array.isArray(clone[key])) {
      clone[key] = items;
      return clone;
    }
  }
  clone.items = items;
  return clone;
}

/**
 * Keep business rows (teams/clubs) when an MCP envelope overflows the budget.
 * Provenance `sources` is dropped first — that is what blows Nevobo get_club_teams.
 */
function compactExternalSourceToolResult(
  result: { name: string; ok: boolean; summary: string; data?: unknown; code?: string },
  maxChars: number,
): string {
  const summary = truncateText(result.summary, 240);
  let data = result.data !== undefined ? stripSources(structuredClone(result.data)) : undefined;

  const pack = (payload: unknown, truncated: boolean) =>
    JSON.stringify({
      name: result.name,
      ok: result.ok,
      summary,
      ...(truncated ? { dataTruncated: true as const } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(payload !== undefined ? { data: payload } : {}),
    });

  let out = pack(data, JSON.stringify(result).length > maxChars);
  if (out.length <= maxChars) return out;

  const items = findItemArray(data);
  if (items && items.length > 0) {
    const compactItems = items.map(compactItem);
    data = replaceItemArray(data, compactItems);
    const compactPayload =
      typeof data === "object" && data && !Array.isArray(data)
        ? { ...data, itemCount: items.length }
        : { items: compactItems, itemCount: items.length };
    out = pack(
      {
        ...compactPayload,
        hint: "Provenance omitted; rows compacted. Prefer sourcePath as teamId; UUID is season-specific.",
      },
      true,
    );
    if (out.length <= maxChars) return out;

    const directoryHint =
      "Complete team index. Prefer sourcePath as teamId (stable across seasons). Do not reuse a previous-season UUID. Treat HR1 and HR 1 as the same label.";
    for (const tight of [false, true]) {
      const directory = items.map((item) => indexItem(item, tight));
      out = pack(
        { directory, itemCount: items.length, hint: directoryHint },
        true,
      );
      if (out.length <= maxChars) return out;
    }

    const directory = items.map((item) => indexItem(item, true));

    const keep = Math.max(1, Math.min(directory.length, 80));
    let lo = 1;
    let hi = keep;
    let best = pack(
      { omitted: true, reason: "tool result exceeds context budget", itemCount: items.length },
      true,
    );
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const sliced = directory.slice(0, mid);
      const candidate = pack(
        {
          directory: sliced,
          itemCount: items.length,
          showing: sliced.length,
          hint: `Showing ${sliced.length} of ${items.length} teams in the index. Remaining names were cut for size — do not assume they are absent from Nevobo.`,
        },
        true,
      );
      if (candidate.length <= maxChars) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  if (out.length > maxChars) {
    return JSON.stringify({
      name: result.name,
      ok: result.ok,
      summary,
      dataTruncated: true,
      data: { omitted: true, reason: "tool result exceeds context budget" },
    });
  }
  return out;
}

function looksLikeEntryData(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const rec = data as Record<string, unknown>;
  return (
    (typeof rec.id === "string" &&
      rec.fields !== null &&
      typeof rec.fields === "object") ||
    Object.values(rec).some((v) => typeof v === "string" && v.length > 200)
  );
}

/**
 * JSON for the model transcript. Keeps name/ok/summary.
 * `get_entry_field` is never sliced. `get_entry` omits large strings with hashes.
 */
export function truncateToolResultForModel(
  result: { name: string; ok: boolean; summary: string; data?: unknown; code?: string },
  maxChars: number = resolveToolResultMaxChars(),
): string {
  if (NEVER_SLICE_TOOL_RESULTS.has(result.name)) {
    return JSON.stringify(result);
  }

  const full = JSON.stringify(result);
  if (full.length <= maxChars) return full;

  if (EXTERNAL_SOURCE_TOOLS.has(result.name)) {
    return compactExternalSourceToolResult(result, maxChars);
  }

  if (result.name === "get_entry" || looksLikeEntryData(result.data)) {
    return compactEntryToolResult(result, maxChars);
  }

  const summaryBudget = Math.min(500, Math.floor(maxChars * 0.2));
  const base = {
    name: result.name,
    ok: result.ok,
    summary: truncateText(result.summary, summaryBudget),
    dataTruncated: true as const,
    ...(result.code ? { code: result.code } : {}),
  };

  const overhead = JSON.stringify({ ...base, data: "" }).length + 32;
  const dataBudget = Math.max(80, maxChars - overhead);

  let dataPreview: unknown;
  if (result.data == null) {
    dataPreview = undefined;
  } else if (typeof result.data === "string") {
    dataPreview = truncateText(result.data, dataBudget);
  } else {
    try {
      dataPreview = truncateText(JSON.stringify(result.data), dataBudget);
    } catch {
      dataPreview = "[unserializable data truncated]";
    }
  }

  let out = JSON.stringify({
    ...base,
    ...(dataPreview !== undefined ? { data: dataPreview } : {}),
  });
  if (out.length > maxChars) {
    out = JSON.stringify({
      ...base,
      data: { omitted: true, reason: "tool result exceeds context budget" },
    });
  }
  return out;
}

/** Rough input size for metering (messages + tool schemas). */
export function estimateChatInputChars(
  messages: Array<{ content?: string | null; tool_calls?: unknown }>,
  tools: Array<{ function: { name: string; description?: string; parameters?: unknown } }>,
): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    if (m.tool_calls) {
      try {
        chars += JSON.stringify(m.tool_calls).length;
      } catch {
        /* ignore */
      }
    }
  }
  try {
    chars += JSON.stringify(tools).length;
  } catch {
    /* ignore */
  }
  return chars;
}
