import { prisma } from "../db.js";

const envOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let cache: { at: number; websiteOrigins: Set<string> } | null = null;
const CACHE_MS = 15_000;

/** Drop cached website origins (call after PATCH /admin/website). */
export function invalidateCorsOriginCache(): void {
  cache = null;
}

async function loadWebsiteOrigins(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return cache.websiteOrigins;
  }

  const rows = await prisma.website.findMany({
    select: { allowedOrigins: true },
  });
  const websiteOrigins = new Set<string>();
  for (const row of rows) {
    for (const origin of row.allowedOrigins) {
      const trimmed = origin.trim();
      if (trimmed) websiteOrigins.add(trimmed);
    }
  }
  cache = { at: now, websiteOrigins };
  return websiteOrigins;
}

/** True when Origin may call the API (global env ∪ any website.allowedOrigins). */
export async function isCorsOriginAllowed(
  origin: string | undefined,
): Promise<boolean> {
  // Non-browser clients (curl, server-to-server) send no Origin.
  if (!origin) return true;
  if (envOrigins.includes(origin)) return true;
  const websiteOrigins = await loadWebsiteOrigins();
  return websiteOrigins.has(origin);
}

/** Normalize a list of origin URLs to canonical `https://host[:port]` forms. */
export function normalizeAllowedOrigins(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      out.add(new URL(trimmed).origin);
    } catch {
      // skip invalid
    }
  }
  return [...out].sort();
}
