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
