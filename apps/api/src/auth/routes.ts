import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  invalidateCorsOriginCache,
  normalizeAllowedOrigins,
} from "../cors/origins.js";
import {
  hashPassword,
  signAccessToken,
  verifyPassword,
} from "./password.js";
import { requireUser, requireWebsite, websiteIdFrom } from "./middleware.js";
import {
  generateApiTokenSecret,
  generateUserApiTokenSecret,
  serializeApiToken,
} from "./apiTokens.js";
import {
  authUserForWebsite,
  createWebsiteWithAdmin,
  issueAuthResponse,
  listUserWebsites,
  publicUser,
} from "./websites.js";
import { RolePermission } from "./roles.js";
import {
  assertLocalesRemovable,
  normalizeWebsiteLocalesInput,
} from "../lib/locales.js";
import { assertRateLimit, clientIpFromHeaders } from "../lib/rateLimit.js";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  websiteName: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SelectWebsiteSchema = z.object({
  websiteId: z.string().min(1),
});

const CreateWebsiteSchema = z.object({
  name: z.string().min(1),
});

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

const AddMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(["editor", "builder", "admin"]),
  password: z.string().min(8).optional(),
});

const UpdateMemberSchema = z.object({
  role: z.enum(["editor", "builder", "admin"]),
});

const UpdateWebsiteSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.union([z.string().max(2000), z.literal("")]).optional(),
  allowedOrigins: z.array(z.string().max(500)).max(50).optional(),
  locales: z
    .array(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/))
    .min(1)
    .max(50)
    .optional(),
  defaultLocale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
});

function serializeWebsite(website: {
  id: string;
  name: string;
  description: string | null;
  siteKey: string;
  allowedOrigins: string[];
  locales: string[];
  defaultLocale: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: website.id,
    name: website.name,
    description: website.description,
    siteKey: website.siteKey,
    allowedOrigins: website.allowedOrigins ?? [],
    locales: website.locales ?? ["en-US"],
    defaultLocale: website.defaultLocale ?? "en-US",
    createdAt: website.createdAt.toISOString(),
    updatedAt: website.updatedAt.toISOString(),
  };
}

function clientIp(request: FastifyRequest): string {
  return clientIpFromHeaders({
    headers: request.headers as Record<string, unknown>,
    ip: request.ip,
  });
}

function assertAuthRateLimit(kind: "login" | "register", request: FastifyRequest, email?: string) {
  const ip = clientIp(request);
  if (kind === "login") {
    assertRateLimit(`auth:login:${ip}:${email ?? ""}`, {
      windowMs: 60_000,
      max: 10,
      message: "Too many login attempts. Try again shortly.",
    });
    return;
  }
  assertRateLimit(`auth:register:${ip}`, {
    windowMs: 60_000,
    max: 5,
    message: "Too many registration attempts. Try again shortly.",
  });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    try {
      const body = RegisterSchema.parse(request.body);
      const email = body.email.toLowerCase().trim();
      assertAuthRateLimit("register", request);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ message: "Email already registered" });
      }

      const user = await prisma.user.create({
        data: {
          email,
          name: body.name?.trim() || null,
          passwordHash: hashPassword(body.password),
        },
      });

      const websiteName =
        body.websiteName?.trim() ||
        (body.name?.trim() ? `${body.name.trim()}'s site` : "My website");

      await createWebsiteWithAdmin({
        userId: user.id,
        name: websiteName,
      });

      return issueAuthResponse(user);
    } catch (err) {
      const e = err as Error & { statusCode?: number; apiCode?: string };
      if (e.statusCode === 429) {
        return reply.status(429).send({
          message: e.message,
          code: e.apiCode ?? "RATE_LIMITED",
        });
      }
      throw err;
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    try {
      const body = LoginSchema.parse(request.body);
      const email = body.email.toLowerCase().trim();
      assertAuthRateLimit("login", request, email);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        return reply.status(401).send({ message: "Invalid email or password" });
      }

      return issueAuthResponse(user);
    } catch (err) {
      const e = err as Error & { statusCode?: number; apiCode?: string };
      if (e.statusCode === 429) {
        return reply.status(429).send({
          message: e.message,
          code: e.apiCode ?? "RATE_LIMITED",
        });
      }
      throw err;
    }
  });

  app.register(async (authed) => {
    authed.addHook("preHandler", requireUser);

    authed.get("/api/v1/auth/me", async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user!.id },
      });
      const websites = await listUserWebsites(user.id);
      const active = request.user!.websiteId
        ? websites.find((w) => w.id === request.user!.websiteId)
        : null;

      return {
        user: publicUser(user, {
          websiteId: active?.id ?? null,
          websiteName: active?.name ?? null,
          role: active?.role ?? null,
          siteKey: active?.siteKey ?? null,
        }),
        websites,
        needsWebsiteSelection: !active && websites.length > 1,
        authMethod: request.authMethod ?? "jwt",
      };
    });

    authed.get("/api/v1/auth/websites", async (request) => {
      return listUserWebsites(request.user!.id);
    });

    authed.post("/api/v1/auth/select-website", async (request, reply) => {
      if (request.user!.id.startsWith("token:")) {
        return reply.status(403).send({
          message:
            "Website-scoped API tokens cannot switch websites. Use a personal access token (aur_u_…) or a user session.",
        });
      }
      const body = SelectWebsiteSchema.parse(request.body);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user!.id },
      });
      try {
        const authUser = await authUserForWebsite(user, body.websiteId);
        const token = await signAccessToken(authUser);
        const websites = await listUserWebsites(user.id);
        return {
          token,
          user: publicUser(user, authUser),
          websites,
          needsWebsiteSelection: false,
        };
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 403;
        return reply.status(status).send({
          message: err instanceof Error ? err.message : "Forbidden",
        });
      }
    });

    authed.post("/api/v1/auth/websites", async (request) => {
      const body = CreateWebsiteSchema.parse(request.body);
      const website = await createWebsiteWithAdmin({
        userId: request.user!.id,
        name: body.name,
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user!.id },
      });
      return issueAuthResponse(user, website.id);
    });

    // Personal access tokens (user-scoped, for MCP)
    authed.get("/api/v1/auth/user-tokens", async (request, reply) => {
      if (request.user!.id.startsWith("token:")) {
        return reply.status(403).send({
          message: "Personal tokens require a user session or aur_u_… token",
        });
      }
      const rows = await prisma.userApiToken.findMany({
        where: { userId: request.user!.id },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(serializeApiToken);
    });

    authed.post("/api/v1/auth/user-tokens", async (request, reply) => {
      if (request.user!.id.startsWith("token:")) {
        return reply.status(403).send({
          message: "Personal tokens require a user session or aur_u_… token",
        });
      }
      const body = CreateTokenSchema.parse(request.body);
      const generated = generateUserApiTokenSecret();
      const expiresAt =
        body.expiresInDays != null
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null;

      const row = await prisma.userApiToken.create({
        data: {
          userId: request.user!.id,
          name: body.name.trim(),
          tokenHash: generated.hash,
          prefix: generated.prefix,
          expiresAt,
        },
      });

      return {
        token: generated.raw,
        ...serializeApiToken(row),
        warning: "Store this token now — it will not be shown again.",
      };
    });

    authed.delete<{ Params: { id: string } }>(
      "/api/v1/auth/user-tokens/:id",
      async (request, reply) => {
        if (request.user!.id.startsWith("token:")) {
          return reply.status(403).send({
            message: "Personal tokens require a user session or aur_u_… token",
          });
        }
        const existing = await prisma.userApiToken.findFirst({
          where: {
            id: request.params.id,
            userId: request.user!.id,
          },
        });
        if (!existing) {
          return reply.status(404).send({ message: "Token not found" });
        }
        await prisma.userApiToken.delete({ where: { id: existing.id } });
        return { ok: true as const };
      },
    );
  });

  // Website-scoped admin routes (tokens + members)
  app.register(async (admin) => {
    admin.addHook("preHandler", requireWebsite(RolePermission.schema));

    admin.get("/api/v1/admin/tokens", async (request) => {
      const rows = await prisma.apiToken.findMany({
        where: { websiteId: websiteIdFrom(request) },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(serializeApiToken);
    });

    admin.post("/api/v1/admin/tokens", async (request) => {
      const body = CreateTokenSchema.parse(request.body);
      const generated = generateApiTokenSecret();
      const expiresAt =
        body.expiresInDays != null
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null;

      const row = await prisma.apiToken.create({
        data: {
          websiteId: websiteIdFrom(request),
          createdById: request.user!.id.startsWith("token:")
            ? null
            : request.user!.id,
          name: body.name.trim(),
          tokenHash: generated.hash,
          prefix: generated.prefix,
          expiresAt,
        },
      });

      return {
        token: generated.raw,
        ...serializeApiToken(row),
        warning: "Store this token now — it will not be shown again.",
      };
    });

    admin.delete<{ Params: { id: string } }>(
      "/api/v1/admin/tokens/:id",
      async (request, reply) => {
        const existing = await prisma.apiToken.findFirst({
          where: {
            id: request.params.id,
            websiteId: websiteIdFrom(request),
          },
        });
        if (!existing) {
          return reply.status(404).send({ message: "Token not found" });
        }
        await prisma.apiToken.delete({ where: { id: existing.id } });
        return { ok: true as const };
      },
    );
  });

  // Active website details — readable by any member (editor+). Needed for
  // locale filters on entry pages; PATCH stays admin-only below.
  app.register(async (websiteRead) => {
    websiteRead.addHook("preHandler", requireWebsite());

    websiteRead.get("/api/v1/admin/website", async (request) => {
      const website = await prisma.website.findUniqueOrThrow({
        where: { id: websiteIdFrom(request) },
      });
      return serializeWebsite(website);
    });
  });

  app.register(async (members) => {
    members.addHook("preHandler", requireWebsite(RolePermission.admin));

    members.patch("/api/v1/admin/website", async (request) => {
      const body = UpdateWebsiteSchema.parse(request.body);
      const websiteId = websiteIdFrom(request);

      const current = await prisma.website.findUniqueOrThrow({
        where: { id: websiteId },
      });

      let localesUpdate:
        | { locales: string[]; defaultLocale: string }
        | undefined;
      if (body.locales !== undefined || body.defaultLocale !== undefined) {
        localesUpdate = normalizeWebsiteLocalesInput({
          locales: body.locales,
          defaultLocale: body.defaultLocale,
          current: {
            locales: current.locales,
            defaultLocale: current.defaultLocale,
          },
        });
        await assertLocalesRemovable(
          websiteId,
          localesUpdate.locales,
          current.locales,
        );
      }

      const hasUpdate =
        body.name !== undefined ||
        body.description !== undefined ||
        body.allowedOrigins !== undefined ||
        localesUpdate !== undefined;

      const website = !hasUpdate
        ? current
        : await prisma.website.update({
            where: { id: websiteId },
            data: {
              ...(body.name !== undefined ? { name: body.name.trim() } : {}),
              ...(body.description !== undefined
                ? { description: body.description.trim() || null }
                : {}),
              ...(body.allowedOrigins !== undefined
                ? {
                    allowedOrigins: normalizeAllowedOrigins(body.allowedOrigins),
                  }
                : {}),
              ...(localesUpdate
                ? {
                    locales: localesUpdate.locales,
                    defaultLocale: localesUpdate.defaultLocale,
                  }
                : {}),
            },
          });

      if (body.allowedOrigins !== undefined) {
        invalidateCorsOriginCache();
      }

      // Refresh JWT websiteName when the caller is a real user session.
      if (request.authMethod === "jwt") {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: request.user!.id },
        });
        const authUser = await authUserForWebsite(user, website.id);
        const token = await signAccessToken(authUser);
        const websites = await listUserWebsites(user.id);
        return {
          website: serializeWebsite(website),
          token,
          user: publicUser(user, authUser),
          websites,
        };
      }

      return {
        website: serializeWebsite(website),
        token: null,
        user: null,
        websites: [],
      };
    });

    members.get("/api/v1/admin/members", async (request) => {
      const websiteId = websiteIdFrom(request);
      const rows = await prisma.membership.findMany({
        where: { websiteId },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((m) => ({
        id: m.id,
        role: m.role,
        user: {
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
        },
        createdAt: m.createdAt.toISOString(),
      }));
    });

    members.post("/api/v1/admin/members", async (request, reply) => {
      const body = AddMemberSchema.parse(request.body);
      const websiteId = websiteIdFrom(request);
      const email = body.email.toLowerCase().trim();

      let user = await prisma.user.findUnique({ where: { email } });
      let temporaryPassword: string | undefined;

      if (!user) {
        if (!body.password) {
          return reply.status(400).send({
            message:
              "User does not exist yet — provide password to create their account",
          });
        }
        user = await prisma.user.create({
          data: {
            email,
            name: body.name?.trim() || null,
            passwordHash: hashPassword(body.password),
          },
        });
        temporaryPassword = body.password;
      }

      const existing = await prisma.membership.findUnique({
        where: { userId_websiteId: { userId: user.id, websiteId } },
      });
      if (existing) {
        return reply
          .status(409)
          .send({ message: "User is already a member of this website" });
      }

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          websiteId,
          role: body.role,
        },
        include: { user: true },
      });

      return {
        id: membership.id,
        role: membership.role,
        user: {
          id: membership.user.id,
          email: membership.user.email,
          name: membership.user.name,
        },
        createdAt: membership.createdAt.toISOString(),
        ...(temporaryPassword
          ? {
              temporaryPassword,
              warning:
                "Share this password securely — it will not be shown again.",
            }
          : {}),
      };
    });

    members.patch<{ Params: { id: string } }>(
      "/api/v1/admin/members/:id",
      async (request, reply) => {
        const body = UpdateMemberSchema.parse(request.body);
        const websiteId = websiteIdFrom(request);
        const membership = await prisma.membership.findFirst({
          where: { id: request.params.id, websiteId },
          include: { user: true },
        });
        if (!membership) {
          return reply.status(404).send({ message: "Member not found" });
        }

        if (
          membership.role === "admin" &&
          body.role !== "admin" &&
          membership.userId === request.user!.id
        ) {
          const adminCount = await prisma.membership.count({
            where: { websiteId, role: "admin" },
          });
          if (adminCount <= 1) {
            return reply.status(400).send({
              message: "Cannot demote the last admin of this website",
            });
          }
        }

        const updated = await prisma.membership.update({
          where: { id: membership.id },
          data: { role: body.role },
          include: { user: true },
        });

        return {
          id: updated.id,
          role: updated.role,
          user: {
            id: updated.user.id,
            email: updated.user.email,
            name: updated.user.name,
          },
          createdAt: updated.createdAt.toISOString(),
        };
      },
    );

    members.delete<{ Params: { id: string } }>(
      "/api/v1/admin/members/:id",
      async (request, reply) => {
        const websiteId = websiteIdFrom(request);
        const membership = await prisma.membership.findFirst({
          where: { id: request.params.id, websiteId },
        });
        if (!membership) {
          return reply.status(404).send({ message: "Member not found" });
        }

        if (membership.role === "admin") {
          const adminCount = await prisma.membership.count({
            where: { websiteId, role: "admin" },
          });
          if (adminCount <= 1) {
            return reply.status(400).send({
              message: "Cannot remove the last admin of this website",
            });
          }
        }

        await prisma.membership.delete({ where: { id: membership.id } });
        return { ok: true as const };
      },
    );
  });
}
