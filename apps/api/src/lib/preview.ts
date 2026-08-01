import { createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_TTL_MS = 60 * 60 * 1000; // 1 hour

export type PreviewClaims = {
  websiteId: string;
  entryId: string;
  contentTypeApiId: string;
  exp: number;
};

function secret(): string {
  return process.env.CMS_JWT_SECRET ?? "dev-insecure-secret-change-me";
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function mintPreviewToken(claims: Omit<PreviewClaims, "exp">): {
  token: string;
  expiresAt: string;
} {
  const exp = Date.now() + PREVIEW_TTL_MS;
  const payload = b64url(JSON.stringify({ ...claims, exp }));
  const sig = b64url(
    createHmac("sha256", secret()).update(payload).digest(),
  );
  return {
    token: `${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyPreviewToken(token: string): PreviewClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expected = b64url(
    createHmac("sha256", secret()).update(payload).digest(),
  );
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as PreviewClaims;
    if (
      typeof claims.websiteId !== "string" ||
      typeof claims.entryId !== "string" ||
      typeof claims.contentTypeApiId !== "string" ||
      typeof claims.exp !== "number"
    ) {
      return null;
    }
    if (Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
