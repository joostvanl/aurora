/** Server-side context budgets for the AI agent (token cost control). */

export const DEFAULT_AI_HISTORY_MAX = 10;
export const DEFAULT_AI_TOOL_RESULT_MAX_CHARS = 6_000;
export const DEFAULT_AI_KNOWLEDGE_MAX_CHARS = 6_000;
export const DEFAULT_AI_KNOWLEDGE_MAX_CHARS_FOCUSED = 12_000;
export const DEFAULT_AI_INDEX_PER_TYPE = 15;
export const DEFAULT_AI_INDEX_PER_TYPE_FOCUSED = 40;

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

/**
 * JSON for the model transcript. Keeps name/ok/summary; truncates bulky `data`.
 */
export function truncateToolResultForModel(
  result: { name: string; ok: boolean; summary: string; data?: unknown },
  maxChars: number = resolveToolResultMaxChars(),
): string {
  const full = JSON.stringify(result);
  if (full.length <= maxChars) return full;

  const summaryBudget = Math.min(500, Math.floor(maxChars * 0.2));
  const base = {
    name: result.name,
    ok: result.ok,
    summary: truncateText(result.summary, summaryBudget),
    dataTruncated: true as const,
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
    out = `${out.slice(0, maxChars - 1)}…`;
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
