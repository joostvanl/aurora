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

/** Localhost / 127.0.0.1 on any port — local DX out of the box. */
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** True when Origin may call the API (local ∪ global env ∪ any website.allowedOrigins). */
export async function isCorsOriginAllowed(
  origin: string | undefined,
): Promise<boolean> {
  // Non-browser clients (curl, server-to-server) send no Origin.
  if (!origin) return true;
  if (isLocalDevOrigin(origin)) return true;
  if (envOrigins.includes(origin)) return true;
  const websiteOrigins = await loadWebsiteOrigins();
  return websiteOrigins.has(origin);
}

export async function corsCheckResult(origin: string | undefined): Promise<{
  allowed: boolean;
  origin: string | null;
  hint: string;
}> {
  if (!origin) {
    return {
      allowed: true,
      origin: null,
      hint: "No Origin header — non-browser clients are allowed.",
    };
  }
  const allowed = await isCorsOriginAllowed(origin);
  if (allowed) {
    return {
      allowed: true,
      origin,
      hint: "Origin is allowed (local, CORS_ORIGINS, or website.allowedOrigins).",
    };
  }
  return {
    allowed: false,
    origin,
    hint: `Origin "${origin}" is not in allowedOrigins. Add it under Admin → Website, or use a local proxy. Localhost and 127.0.0.1 (any port) are always allowed.`,
  };
}

/** Normalize a list of origin URLs to canonical `https://host[:port]` forms. */
export function normalizeAllowedOrigins(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const port =
        url.port &&
        !((url.protocol === "http:" && url.port === "80") ||
          (url.protocol === "https:" && url.port === "443"))
          ? `:${url.port}`
          : "";
      out.add(`${url.protocol}//${url.hostname}${port}`);
    } catch {
      /* skip invalid */
    }
  }
  return [...out];
}

/** Default origins seeded on demo tenant (defensive; global localhost rule also applies). */
export const DEMO_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];
