import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { WebsiteRole } from "@prisma/client";

const JWT_ISSUER = "aurora-cms";
const JWT_AUD = "aurora-admin";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  websiteId: string | null;
  websiteName: string | null;
  role: WebsiteRole | null;
  siteKey: string | null;
};

function getJwtSecret() {
  const secret = process.env.CMS_JWT_SECRET?.trim();
  if (!secret) {
    throw Object.assign(new Error("CMS_JWT_SECRET is not configured"), {
      statusCode: 500,
    });
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    websiteId: user.websiteId,
    websiteName: user.websiteName,
    role: user.role,
    siteKey: user.siteKey,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUD)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUD,
  });
  if (!payload.sub || typeof payload.email !== "string") {
    throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
  }
  const role =
    payload.role === "editor" ||
    payload.role === "builder" ||
    payload.role === "admin"
      ? payload.role
      : null;

  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
    websiteId: typeof payload.websiteId === "string" ? payload.websiteId : null,
    websiteName:
      typeof payload.websiteName === "string" ? payload.websiteName : null,
    role,
    siteKey: typeof payload.siteKey === "string" ? payload.siteKey : null,
  };
}

export function createSiteKey(): string {
  return createHash("sha256")
    .update(randomBytes(32))
    .digest("hex")
    .slice(0, 32);
}

export function toAuthUser(input: {
  id: string;
  email: string;
  name: string | null;
  websiteId?: string | null;
  websiteName?: string | null;
  role?: WebsiteRole | null;
  siteKey?: string | null;
}): AuthUser {
  return {
    id: input.id,
    email: input.email,
    name: input.name,
    websiteId: input.websiteId ?? null,
    websiteName: input.websiteName ?? null,
    role: input.role ?? null,
    siteKey: input.siteKey ?? null,
  };
}
