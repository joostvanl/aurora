import type { AiConfigUpdate, AiMacro } from "@cms/shared";
import { AI_MACROS_MAX, AiMacroSchema } from "@cms/shared";
import { prisma } from "../db.js";
import { sumAiUsageForWebsite } from "./usage.js";

const KEYS = {
  baseUrl: "ai.baseUrl",
  apiKey: "ai.apiKey",
  model: "ai.model",
  /** EUR charged / estimated per single token (e.g. 0.000012). */
  costPerTokenEur: "ai.costPerTokenEur",
  /** Website-specific behavior instructions appended to every AI system prompt. */
  instructions: "ai.instructions",
  /** JSON array of custom AI dock macros. */
  macros: "ai.macros",
} as const;

/** Default when unset — ≈ €0.012 per 1k tokens. */
export const DEFAULT_COST_PER_TOKEN_EUR = 0.000012;

/** Soft cap for stored website AI instructions. */
export const AI_INSTRUCTIONS_MAX_CHARS = 8_000;

export type ResolvedAiConfig = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  costPerTokenEur: number;
  /** Custom instructions for this website (empty string when unset). */
  instructions: string;
  macros: AiMacro[];
  /** Per-website settings — never shared via env. */
  source: "settings" | "none";
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

function parseCostPerToken(raw: string | null): number {
  if (!raw) return DEFAULT_COST_PER_TOKEN_EUR;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COST_PER_TOKEN_EUR;
  return n;
}

function parseMacros(raw: string | null): AiMacro[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = AiMacroSchema.array().max(AI_MACROS_MAX).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function normalizeMacros(input: AiMacro[]): AiMacro[] {
  const seen = new Set<string>();
  const out: AiMacro[] = [];
  for (const m of input) {
    const id = m.id.trim();
    const name = m.name.trim();
    const prompt = m.prompt.trim();
    if (!id || !name || !prompt) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, prompt });
    if (out.length >= AI_MACROS_MAX) break;
  }
  return out;
}

async function getSetting(
  websiteId: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.setting.findUnique({
    where: { websiteId_key: { websiteId, key } },
  });
  const value = row?.value?.trim();
  return value ? value : null;
}

/** Resolve AI config for one website (admin-configured). */
export async function resolveAiConfig(
  websiteId: string,
): Promise<ResolvedAiConfig> {
  const [baseUrl, apiKey, model, costRaw, instructionsRaw, macrosRaw] =
    await Promise.all([
      getSetting(websiteId, KEYS.baseUrl),
      getSetting(websiteId, KEYS.apiKey),
      getSetting(websiteId, KEYS.model),
      getSetting(websiteId, KEYS.costPerTokenEur),
      getSetting(websiteId, KEYS.instructions),
      getSetting(websiteId, KEYS.macros),
    ]);

  const configured = Boolean(baseUrl && apiKey && model);
  const hasAny = Boolean(
    baseUrl || apiKey || model || costRaw || instructionsRaw || macrosRaw,
  );

  return {
    enabled: configured,
    configured,
    baseUrl,
    model,
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: maskKey(apiKey),
    costPerTokenEur: parseCostPerToken(costRaw),
    instructions: instructionsRaw ?? "",
    macros: parseMacros(macrosRaw),
    source: hasAny ? "settings" : "none",
  };
}

async function upsertSetting(websiteId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { websiteId_key: { websiteId, key } },
    create: { websiteId, key, value },
    update: { value },
  });
}

async function deleteSetting(websiteId: string, key: string) {
  await prisma.setting.deleteMany({ where: { websiteId, key } });
}

export async function updateAiConfig(
  websiteId: string,
  input: AiConfigUpdate,
) {
  if (input.baseUrl !== undefined) {
    const value = input.baseUrl.trim();
    if (!value) await deleteSetting(websiteId, KEYS.baseUrl);
    else await upsertSetting(websiteId, KEYS.baseUrl, value);
  }

  if (input.clearApiKey) {
    await deleteSetting(websiteId, KEYS.apiKey);
  } else if (input.apiKey !== undefined) {
    const value = input.apiKey.trim();
    if (!value) await deleteSetting(websiteId, KEYS.apiKey);
    else await upsertSetting(websiteId, KEYS.apiKey, value);
  }

  if (input.model !== undefined) {
    const value = input.model.trim();
    if (!value) await deleteSetting(websiteId, KEYS.model);
    else await upsertSetting(websiteId, KEYS.model, value);
  }

  if (input.costPerTokenEur !== undefined) {
    if (input.costPerTokenEur === null) {
      await deleteSetting(websiteId, KEYS.costPerTokenEur);
    } else {
      const n = Number(input.costPerTokenEur);
      if (!Number.isFinite(n) || n < 0) {
        throw Object.assign(new Error("costPerTokenEur must be a non-negative number"), {
          statusCode: 400,
        });
      }
      await upsertSetting(websiteId, KEYS.costPerTokenEur, String(n));
    }
  }

  if (input.instructions !== undefined) {
    if (input.instructions === null) {
      await deleteSetting(websiteId, KEYS.instructions);
    } else {
      const value = input.instructions.trim();
      if (!value) {
        await deleteSetting(websiteId, KEYS.instructions);
      } else if (value.length > AI_INSTRUCTIONS_MAX_CHARS) {
        throw Object.assign(
          new Error(
            `instructions must be at most ${AI_INSTRUCTIONS_MAX_CHARS} characters`,
          ),
          { statusCode: 400 },
        );
      } else {
        await upsertSetting(websiteId, KEYS.instructions, value);
      }
    }
  }

  if (input.macros !== undefined) {
    const macros = normalizeMacros(input.macros);
    if (macros.length === 0) {
      await deleteSetting(websiteId, KEYS.macros);
    } else {
      await upsertSetting(websiteId, KEYS.macros, JSON.stringify(macros));
    }
  }

  return resolveAiConfig(websiteId);
}

export async function toPublicAiStatus(websiteId: string) {
  const config = await resolveAiConfig(websiteId);
  const usage = await sumAiUsageForWebsite(websiteId);
  const estimatedCostEur =
    Math.round(usage.totalTokens * config.costPerTokenEur * 1_000_000) /
    1_000_000;

  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeyPreview: config.apiKeyPreview,
    source: config.source,
    costPerTokenEur: config.costPerTokenEur,
    instructions: config.instructions,
    macros: config.macros,
    usage: {
      periodFrom: usage.from,
      periodTo: usage.to,
      callCount: usage.callCount,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCostEur,
    },
  };
}
