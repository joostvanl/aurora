import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebsiteRole } from "@prisma/client";
import { prisma } from "../db.js";
import { verifyAccessToken, type AuthUser } from "./password.js";
import { looksLikeApiToken, resolveApiToken } from "./apiTokens.js";
import { roleAtLeast } from "./roles.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    /** Public API: website id resolved from x-site-key */
    siteWebsiteId?: string;
    authMethod?: "jwt" | "api_token";
  }
}

function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Identity auth (JWT or API token). Does not require an active website.
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = readBearer(request);
  if (!token) {
    return reply.status(401).send({
      message:
        "Authentication required. Use Authorization: Bearer <jwt|aur_… api token>",
    });
  }

  try {
    if (looksLikeApiToken(token)) {
      const user = await resolveApiToken(token);
      if (!user) {
        return reply.status(401).send({ message: "Invalid or expired API token" });
      }
      request.user = user;
      request.authMethod = "api_token";
      return;
    }

    request.user = await verifyAccessToken(token);
    request.authMethod = "jwt";
  } catch {
    return reply.status(401).send({ message: "Invalid or expired token" });
  }
}

/**
 * Requires authenticated user with an active website context.
 * Optional minimum role (editor < builder < admin).
 */
export function requireWebsite(minimum?: WebsiteRole) {
  return async function requireWebsiteHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    await requireUser(request, reply);
    if (reply.sent) return;

    if (!request.user?.websiteId || !request.user.role) {
      return reply.status(403).send({
        message:
          "Select a website first (POST /api/v1/auth/select-website) or use a website-scoped API token",
      });
    }

    if (minimum && !roleAtLeast(request.user.role, minimum)) {
      return reply.status(403).send({
        message: `Requires role ${minimum} or higher (current: ${request.user.role})`,
      });
    }
  };
}

/**
 * Public content API: resolve tenant via x-site-key → Website.
 */
export async function requireSiteKey(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const siteKey = request.headers["x-site-key"];
  if (typeof siteKey !== "string" || !siteKey.trim()) {
    return reply.status(401).send({
      message: "Missing x-site-key header (public site key for this website)",
      code: "SITE_KEY_MISSING",
    });
  }

  const website = await prisma.website.findUnique({
    where: { siteKey: siteKey.trim() },
    select: { id: true },
  });
  if (!website) {
    return reply.status(401).send({
      message: "Invalid site key",
      code: "SITE_KEY_INVALID",
    });
  }
  request.siteWebsiteId = website.id;
}

export function userIdFrom(request: FastifyRequest): string {
  if (!request.user?.id) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return request.user.id;
}

export function websiteIdFrom(request: FastifyRequest): string {
  if (!request.user?.websiteId) {
    throw Object.assign(new Error("Website context required"), {
      statusCode: 403,
    });
  }
  return request.user.websiteId;
}

export function siteWebsiteIdFrom(request: FastifyRequest): string {
  if (!request.siteWebsiteId) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return request.siteWebsiteId;
}

/** @deprecated use websiteIdFrom — kept briefly for migrate */
export function siteUserIdFrom(request: FastifyRequest): string {
  return siteWebsiteIdFrom(request);
}
