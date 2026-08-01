import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { toAuthUser, type AuthUser } from "./password.js";

const TOKEN_PREFIX = "aur_";

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiTokenSecret(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const secret = randomBytes(24).toString("base64url");
  const raw = `${TOKEN_PREFIX}${secret}`;
  return {
    raw,
    hash: hashApiToken(raw),
    prefix: raw.slice(0, 12),
  };
}

export function looksLikeApiToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

/** API tokens are website-scoped and act as admin for that website. */
export async function resolveApiToken(raw: string): Promise<AuthUser | null> {
  if (!looksLikeApiToken(raw)) return null;
  const tokenHash = hashApiToken(raw);
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: {
      website: { select: { id: true, name: true, siteKey: true } },
    },
  });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  await prisma.apiToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });

  const creator = row.createdById
    ? await prisma.user.findUnique({
        where: { id: row.createdById },
        select: { id: true, email: true, name: true },
      })
    : null;

  return toAuthUser({
    id: creator?.id ?? `token:${row.id}`,
    email: creator?.email ?? "api-token@aurora.local",
    name: creator?.name ?? row.name,
    websiteId: row.website.id,
    websiteName: row.website.name,
    role: "admin",
    siteKey: row.website.siteKey,
  });
}

export function serializeApiToken(row: {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
