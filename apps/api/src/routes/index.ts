import type { FastifyInstance } from "fastify";
import {
  CreateContentTypeSchema,
  CreateEntrySchema,
  CreateFieldDefinitionSchema,
  ListEntriesQuerySchema,
  UpdateContentTypeSchema,
  UpdateEntrySchema,
  UpdateFieldDefinitionSchema,
} from "@cms/shared";
import { EntryStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { hooks } from "../core/hooks.js";
import {
  requireSiteKey,
  requireWebsite,
  websiteIdFrom,
  siteWebsiteIdFrom,
} from "../auth/middleware.js";
import { roleAtLeast } from "../auth/roles.js";
import { registerAuthRoutes } from "../auth/routes.js";
import {
  entryInclude,
  getContentTypeOrThrow,
  setEntryFields,
} from "../lib/entries.js";
import { serializeContentType, serializeEntry } from "../lib/serialize.js";
import {
  createEntryVersion,
  listEntryVersions,
  restoreEntryVersion,
} from "../lib/versions.js";

import { registerAiRoutes } from "../ai/routes.js";
import { registerMediaRoutes } from "../media/routes.js";
import { registerProvisionRoutes } from "./provision.js";
import { registerFormRoutes } from "./forms.js";

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function assertBuilder(request: { user?: { role?: string | null } }) {
  if (!roleAtLeast(request.user?.role as "editor" | "builder" | "admin" | null, "builder")) {
    throw httpError(403, "Requires builder or admin role");
  }
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app);
  await registerAiRoutes(app);
  await registerMediaRoutes(app);
  await registerProvisionRoutes(app);
  await registerFormRoutes(app);

  // --- Public (site key) ---
  app.register(async (publicApi) => {
    publicApi.addHook("preHandler", requireSiteKey);

    publicApi.get("/api/v1/content-types", async (request) => {
      const websiteId = siteWebsiteIdFrom(request);
      const items = await prisma.contentType.findMany({
        where: { websiteId },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      });
      return items.map(serializeContentType);
    });

    publicApi.get<{ Params: { apiId: string } }>(
      "/api/v1/content-types/:apiId",
      async (request) => {
        const ct = await getContentTypeOrThrow(
          request.params.apiId,
          siteWebsiteIdFrom(request),
        );
        return serializeContentType(ct);
      },
    );

    publicApi.get<{
      Params: { apiId: string };
      Querystring: Record<string, string>;
    }>("/api/v1/content-types/:apiId/entries", async (request) => {
      const ct = await getContentTypeOrThrow(
        request.params.apiId,
        siteWebsiteIdFrom(request),
      );
      const query = ListEntriesQuerySchema.parse(request.query);

      const where = {
        contentTypeId: ct.id,
        status: EntryStatus.published,
        ...(query.slug ? { slug: query.slug } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.entry.findMany({
          where,
          include: entryInclude,
          orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
          take: query.limit,
          skip: query.offset,
        }),
        prisma.entry.count({ where }),
      ]);

      return {
        items: items.map(serializeEntry),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    });

    publicApi.get<{ Params: { apiId: string; slug: string } }>(
      "/api/v1/content-types/:apiId/entries/:slug",
      async (request) => {
        const ct = await getContentTypeOrThrow(
          request.params.apiId,
          siteWebsiteIdFrom(request),
        );
        const entry = await prisma.entry.findFirst({
          where: {
            contentTypeId: ct.id,
            slug: request.params.slug,
            status: EntryStatus.published,
          },
          include: entryInclude,
        });
        if (!entry) throw httpError(404, "Entry not found");
        return serializeEntry(entry);
      },
    );
  });

  // --- Admin (JWT user) ---
  app.register(async (admin) => {
    admin.addHook("preHandler", requireWebsite());

    admin.get("/api/v1/admin/content-types", async (request) => {
      const websiteId = websiteIdFrom(request);
      const items = await prisma.contentType.findMany({
        where: { websiteId },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      });
      return items.map(serializeContentType);
    });

    admin.get<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId",
      async (request) => {
        const ct = await getContentTypeOrThrow(
          request.params.apiId,
          websiteIdFrom(request),
        );
        return serializeContentType(ct);
      },
    );

    admin.post("/api/v1/admin/content-types", async (request) => {
      assertBuilder(request);
      const websiteId = websiteIdFrom(request);
      const body = CreateContentTypeSchema.parse(request.body);
      const existing = await prisma.contentType.findUnique({
        where: { websiteId_apiId: { websiteId, apiId: body.apiId } },
      });
      if (existing) throw httpError(409, `Content type "${body.apiId}" already exists`);

      const ct = await prisma.contentType.create({
        data: {
          websiteId,
          apiId: body.apiId,
          name: body.name,
          description: body.description,
        },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      return serializeContentType(ct);
    });

    admin.patch<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        const body = UpdateContentTypeSchema.parse(request.body);
        await getContentTypeOrThrow(request.params.apiId, websiteId);
        const ct = await prisma.contentType.update({
          where: { websiteId_apiId: { websiteId, apiId: request.params.apiId } },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
          },
          include: { fields: { orderBy: { sortOrder: "asc" } } },
        });
        return serializeContentType(ct);
      },
    );

    admin.delete<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        await getContentTypeOrThrow(request.params.apiId, websiteId);
        await prisma.contentType.delete({
          where: { websiteId_apiId: { websiteId, apiId: request.params.apiId } },
        });
        return { ok: true as const };
      },
    );

    admin.post<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId/fields",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = CreateFieldDefinitionSchema.parse(request.body);
        const maxOrder = ct.fields.reduce(
          (max, f) => Math.max(max, f.sortOrder),
          -1,
        );
        try {
          await prisma.fieldDefinition.create({
            data: {
              contentTypeId: ct.id,
              apiId: body.apiId,
              name: body.name,
              type: body.type,
              required: body.required,
              sortOrder: body.sortOrder ?? maxOrder + 1,
            },
          });
        } catch {
          throw httpError(409, `Field "${body.apiId}" already exists`);
        }
        const updated = await getContentTypeOrThrow(request.params.apiId, websiteId);
        return serializeContentType(updated);
      },
    );

    admin.patch<{ Params: { apiId: string; fieldApiId: string } }>(
      "/api/v1/admin/content-types/:apiId/fields/:fieldApiId",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = UpdateFieldDefinitionSchema.parse(request.body);
        const field = ct.fields.find((f) => f.apiId === request.params.fieldApiId);
        if (!field) throw httpError(404, "Field not found");

        await prisma.fieldDefinition.update({
          where: { id: field.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.required !== undefined ? { required: body.required } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          },
        });
        const updated = await getContentTypeOrThrow(request.params.apiId, websiteId);
        return serializeContentType(updated);
      },
    );

    admin.delete<{ Params: { apiId: string; fieldApiId: string } }>(
      "/api/v1/admin/content-types/:apiId/fields/:fieldApiId",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const field = ct.fields.find((f) => f.apiId === request.params.fieldApiId);
        if (!field) throw httpError(404, "Field not found");
        await prisma.fieldDefinition.delete({ where: { id: field.id } });
        const updated = await getContentTypeOrThrow(request.params.apiId, websiteId);
        return serializeContentType(updated);
      },
    );

    admin.get<{ Params: { apiId: string }; Querystring: Record<string, string> }>(
      "/api/v1/admin/content-types/:apiId/entries",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const query = ListEntriesQuerySchema.parse(request.query);
        const where = {
          contentTypeId: ct.id,
          ...(query.slug ? { slug: query.slug } : {}),
          ...(query.status ? { status: query.status } : {}),
        };
        const [items, total] = await Promise.all([
          prisma.entry.findMany({
            where,
            include: entryInclude,
            orderBy: { updatedAt: "desc" },
            take: query.limit,
            skip: query.offset,
          }),
          prisma.entry.count({ where }),
        ]);
        return {
          items: items.map(serializeEntry),
          total,
          limit: query.limit,
          offset: query.offset,
        };
      },
    );

    admin.get<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/by-id/:entryId",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const entry = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
          include: entryInclude,
        });
        if (!entry) throw httpError(404, "Entry not found");
        return serializeEntry(entry);
      },
    );

    admin.post<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = CreateEntrySchema.parse(request.body);

        const existing = await prisma.entry.findUnique({
          where: {
            contentTypeId_slug_locale: {
              contentTypeId: ct.id,
              slug: body.slug,
              locale: body.locale,
            },
          },
        });
        if (existing) throw httpError(409, `Slug "${body.slug}" already exists`);

        const entry = await prisma.entry.create({
          data: {
            contentTypeId: ct.id,
            slug: body.slug,
            locale: body.locale,
            status: body.status,
            publishedAt:
              body.status === EntryStatus.published ? new Date() : null,
          },
        });

        await setEntryFields(entry.id, ct.id, body.fields);

        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        });

        await hooks.emit("onEntryCreate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });

        if (full.status === EntryStatus.published) {
          await hooks.emit("onEntryPublish", {
            entryId: full.id,
            contentTypeApiId: ct.apiId,
            slug: full.slug,
          });
        }

        return serializeEntry(full);
      },
    );

    admin.patch<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = UpdateEntrySchema.parse(request.body);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");

        if (body.slug && body.slug !== existing.slug) {
          const clash = await prisma.entry.findUnique({
            where: {
              contentTypeId_slug_locale: {
                contentTypeId: ct.id,
                slug: body.slug,
                locale: body.locale ?? existing.locale,
              },
            },
          });
          if (clash) throw httpError(409, `Slug "${body.slug}" already exists`);
        }

        const nextStatus = body.status ?? existing.status;
        await prisma.entry.update({
          where: { id: existing.id },
          data: {
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
            ...(body.locale !== undefined ? { locale: body.locale } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            publishedAt:
              nextStatus === EntryStatus.published
                ? (existing.publishedAt ?? new Date())
                : null,
          },
        });

        if (body.fields) {
          await setEntryFields(existing.id, ct.id, body.fields);
        }

        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: existing.id },
          include: entryInclude,
        });

        await hooks.emit("onEntryUpdate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });

        return serializeEntry(full);
      },
    );

    admin.delete<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");
        await prisma.entry.delete({ where: { id: existing.id } });
        return { ok: true as const };
      },
    );

    admin.get<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/versions",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");
        return listEntryVersions(existing.id);
      },
    );

    admin.post<{
      Params: { apiId: string; entryId: string };
      Body: { label?: string };
    }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/versions",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");
        const label =
          typeof request.body?.label === "string"
            ? request.body.label
            : "Manual checkpoint";
        return createEntryVersion({
          entryId: existing.id,
          label,
          source: "manual",
        });
      },
    );

    admin.post<{
      Params: { apiId: string; entryId: string; versionId: string };
    }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/versions/:versionId/restore",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");
        return restoreEntryVersion({
          contentTypeId: ct.id,
          entryId: existing.id,
          versionId: request.params.versionId,
        });
      },
    );

    admin.post<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/publish",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");

        const full = await prisma.entry.update({
          where: { id: existing.id },
          data: {
            status: EntryStatus.published,
            publishedAt: existing.publishedAt ?? new Date(),
          },
          include: entryInclude,
        });

        await hooks.emit("onEntryPublish", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });

        return serializeEntry(full);
      },
    );

    admin.post<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/unpublish",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");

        const full = await prisma.entry.update({
          where: { id: existing.id },
          data: { status: EntryStatus.draft, publishedAt: null },
          include: entryInclude,
        });

        await hooks.emit("onEntryUnpublish", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });

        return serializeEntry(full);
      },
    );
  });
}
