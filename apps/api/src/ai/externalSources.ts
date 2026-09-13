import { randomUUID } from "node:crypto";
import type {
  ExternalSourcePutItem,
  ExternalSourcesPut,
  PublicExternalSource,
} from "@cms/shared";
import { EXTERNAL_SOURCES_MAX } from "@cms/shared";
import { prisma } from "../db.js";
import { assertSafeUrl, WebFetchError } from "./webFetch.js";

export const EXTERNAL_SOURCES_KEY = "ai.externalSources";

export type StoredExternalSource = {
  id: string;
  label: string;
  type: "mcp_http";
  url: string;
  enabled: boolean;
  authHeaderName: string;
  authHeaderValue?: string;
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

function isSafeHeaderName(name: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name);
}

function asHttpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function parseStored(raw: string | null): StoredExternalSource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredExternalSource[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id.trim() : "";
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const url = typeof rec.url === "string" ? rec.url.trim() : "";
      if (!id || !label || !url || seen.has(id)) continue;
      seen.add(id);
      const authHeaderName =
        typeof rec.authHeaderName === "string" && rec.authHeaderName.trim()
          ? rec.authHeaderName.trim()
          : "Authorization";
      const authHeaderValue =
        typeof rec.authHeaderValue === "string" && rec.authHeaderValue.trim()
          ? rec.authHeaderValue
          : undefined;
      out.push({
        id,
        label,
        type: "mcp_http",
        url,
        enabled: rec.enabled !== false,
        authHeaderName,
        ...(authHeaderValue ? { authHeaderValue } : {}),
      });
      if (out.length >= EXTERNAL_SOURCES_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function toPublicSource(source: StoredExternalSource): PublicExternalSource {
  return {
    id: source.id,
    label: source.label,
    type: source.type,
    url: source.url,
    enabled: source.enabled,
    authHeaderName: source.authHeaderName,
    authConfigured: Boolean(source.authHeaderValue),
    authPreview: maskKey(source.authHeaderValue ?? null),
  };
}

export async function listStoredSources(
  websiteId: string,
): Promise<StoredExternalSource[]> {
  const row = await prisma.setting.findUnique({
    where: { websiteId_key: { websiteId, key: EXTERNAL_SOURCES_KEY } },
  });
  return parseStored(row?.value ?? null);
}

export async function listEnabledSources(
  websiteId: string,
): Promise<StoredExternalSource[]> {
  const sources = await listStoredSources(websiteId);
  return sources.filter((s) => s.enabled);
}

export async function getEnabledSource(
  websiteId: string,
  sourceId: string,
): Promise<StoredExternalSource | null> {
  const id = sourceId.trim();
  if (!id) return null;
  const sources = await listEnabledSources(websiteId);
  return sources.find((s) => s.id === id) ?? null;
}

export async function listPublicSources(websiteId: string) {
  const sources = await listStoredSources(websiteId);
  return { sources: sources.map(toPublicSource) };
}

export async function replaceExternalSources(
  websiteId: string,
  input: ExternalSourcesPut,
) {
  if (input.sources.length > EXTERNAL_SOURCES_MAX) {
    throw asHttpError(
      `At most ${EXTERNAL_SOURCES_MAX} external sources are allowed`,
      400,
    );
  }

  const existing = await listStoredSources(websiteId);
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const next: StoredExternalSource[] = [];

  for (const item of input.sources) {
    const stored = await normalizePutItem(item, existingById);
    if (seen.has(stored.id)) {
      throw asHttpError(`Duplicate source id: ${stored.id}`, 400);
    }
    seen.add(stored.id);
    next.push(stored);
  }

  if (next.length === 0) {
    await prisma.setting.deleteMany({
      where: { websiteId, key: EXTERNAL_SOURCES_KEY },
    });
  } else {
    await prisma.setting.upsert({
      where: { websiteId_key: { websiteId, key: EXTERNAL_SOURCES_KEY } },
      create: {
        websiteId,
        key: EXTERNAL_SOURCES_KEY,
        value: JSON.stringify(next),
      },
      update: { value: JSON.stringify(next) },
    });
  }

  return { sources: next.map(toPublicSource) };
}

async function normalizePutItem(
  item: ExternalSourcePutItem,
  existingById: Map<string, StoredExternalSource>,
): Promise<StoredExternalSource> {
  const label = item.label.trim();
  const url = item.url.trim();
  if (!label) throw asHttpError("label is required", 400);

  try {
    await assertSafeUrl(url);
  } catch (error) {
    const message =
      error instanceof WebFetchError ? error.message : "Invalid source URL";
    throw asHttpError(message, 400);
  }

  const authHeaderName = (item.authHeaderName ?? "Authorization").trim();
  if (!authHeaderName || !isSafeHeaderName(authHeaderName)) {
    throw asHttpError("authHeaderName is not a valid HTTP header name", 400);
  }

  const id = item.id?.trim() || randomUUID();
  const prev = existingById.get(id);
  let authHeaderValue = prev?.authHeaderValue;
  if (item.clearAuth) {
    authHeaderValue = undefined;
  } else if (item.authHeaderValue?.trim()) {
    authHeaderValue = item.authHeaderValue.trim();
  }

  return {
    id,
    label,
    type: "mcp_http",
    url,
    enabled: item.enabled ?? true,
    authHeaderName,
    ...(authHeaderValue ? { authHeaderValue } : {}),
  };
}
