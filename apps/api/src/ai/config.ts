import { prisma } from "../db.js";

const KEYS = {
  baseUrl: "ai.baseUrl",
  apiKey: "ai.apiKey",
  model: "ai.model",
} as const;

export type ResolvedAiConfig = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  /** Per-website settings — never shared via env. */
  source: "settings" | "none";
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
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
  const [baseUrl, apiKey, model] = await Promise.all([
    getSetting(websiteId, KEYS.baseUrl),
    getSetting(websiteId, KEYS.apiKey),
    getSetting(websiteId, KEYS.model),
  ]);

  const configured = Boolean(baseUrl && apiKey && model);
  const hasAny = Boolean(baseUrl || apiKey || model);

  return {
    enabled: configured,
    configured,
    baseUrl,
    model,
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: maskKey(apiKey),
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
  input: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    clearApiKey?: boolean;
  },
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

  return resolveAiConfig(websiteId);
}

export function toPublicAiStatus(config: ResolvedAiConfig) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeyPreview: config.apiKeyPreview,
    source: config.source,
  };
}
