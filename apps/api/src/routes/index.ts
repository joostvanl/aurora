import type { FastifyInstance } from "fastify";
import {
  CreateContentTypeSchema,
  CreateEntrySchema,
  CreateFieldDefinitionSchema,
  CreateTranslationSchema,
  ListEntriesQuerySchema,
  SyncMissingLocalesSchema,
  UpdateContentTypeSchema,
  UpdateEntrySchema,
  UpdateFieldDefinitionSchema,
} from "@cms/shared";
import { EntryStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { hooks } from "../core/hooks.js";
import {
  requireSiteKey,
  requireWebsite,
  websiteIdFrom,
  siteWebsiteIdFrom,
  userIdFrom,
} from "../auth/middleware.js";
import { roleAtLeast } from "../auth/roles.js";
import { registerAuthRoutes } from "../auth/routes.js";
import {
  asCreatedByUserId,
  entryInclude,
  getContentTypeOrThrow,
  setEntryFields,
} from "../lib/entries.js";
import { serializeContentType, serializeEntry } from "../lib/serialize.js";
import {
  assertRelatedContentType,
  settingsToJson,
} from "../lib/fieldSettings.js";
import {
  createEntryVersion,
  listEntryVersions,
  restoreEntryVersion,
} from "../lib/versions.js";
import { listEntriesOrdered } from "../lib/listEntries.js";
import { httpError } from "../lib/httpError.js";
import { mintPreviewToken, verifyPreviewToken } from "../lib/preview.js";
import {
  contentTypeJsonSchema,
  publicOpenApiDocument,
} from "../lib/openapi.js";
import { corsCheckResult } from "../cors/origins.js";
import {
  getWebsiteLocales,
  publicLocalesPayload,
  resolvePublicLocale,
  assertLocaleOnWebsite,
} from "../lib/locales.js";
import {
  createAllLocaleSiblings,
  createTranslationFromEntry,
  syncMissingLocalesForType,
} from "../lib/translations.js";

import { registerAiRoutes } from "../ai/routes.js";
import { registerAnalyticsRoutes } from "../analytics/routes.js";
import { trackContentRequest } from "../analytics/usage.js";
import { registerMediaRoutes } from "../media/routes.js";
import { registerProvisionRoutes } from "./provision.js";
import { registerPackageRoutes } from "./package.js";
import { registerFormRoutes } from "./forms.js";

const API_VERSION = "1";

function assertBuilder(request: { user?: { role?: string | null } }) {
  if (!roleAtLeast(request.user?.role as "editor" | "builder" | "admin" | null, "builder")) {
    throw httpError(403, "Requires builder or admin role", "FORBIDDEN");
  }
}

async function bootstrapPayload(websiteId: string, locale: string) {
  async function safeGet(apiId: string, slug: string) {
    const ct = await prisma.contentType.findUnique({
      where: { websiteId_apiId: { websiteId, apiId } },
    });
    if (!ct) return null;
    const entry = await prisma.entry.findFirst({
      where: {
        contentTypeId: ct.id,
        slug,
        locale,
        status: EntryStatus.published,
      },
      include: entryInclude,
    });
    return entry ? serializeEntry(entry, { normalizeMedia: true }) : null;
  }

  async function safeListNav() {
    try {
      const ct = await getContentTypeOrThrow("nav_item", websiteId);
      const sortOrderField = ct.fields.find((f) => f.apiId === "sortOrder");
      const { items } = await listEntriesOrdered({
        where: {
          contentTypeId: ct.id,
          status: EntryStatus.published,
          locale,
        },
        sort: "sortOrder",
        order: "asc",
        limit: 50,
        offset: 0,
        sortOrderFieldId: sortOrderField?.id ?? null,
      });
      return items.map((e) => serializeEntry(e, { normalizeMedia: true }));
    } catch {
      return [];
    }
  }

  const [siteSettings, nav, primaryPage] = await Promise.all([
    safeGet("site_settings", "default"),
    safeListNav(),
    safeGet("page", "home"),
  ]);

  return { siteSettings, nav, primaryPage, locale };
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/openapi.json", async (request, reply) => {
    const proto = request.protocol;
    const host = request.headers.host ?? "localhost:4000";
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/$/, "") ?? `${proto}://${host}`;
    reply.header("X-Aurora-Api-Version", API_VERSION);
    return publicOpenApiDocument(base);
  });

  app.get<{ Querystring: { origin?: string } }>(
    "/api/v1/cors-check",
    async (request) => {
      const origin =
        typeof request.query.origin === "string"
          ? request.query.origin
          : typeof request.headers.origin === "string"
            ? request.headers.origin
            : undefined;
      const result = await corsCheckResult(origin);
      if (!result.allowed) {
        request.log.warn(
          { origin: result.origin },
          "CORS check: origin not allowed",
        );
      }
      return result;
    },
  );

  await registerAuthRoutes(app);
  await registerAiRoutes(app);
  await registerAnalyticsRoutes(app);
  await registerMediaRoutes(app);
  await registerProvisionRoutes(app);
  await registerPackageRoutes(app);
  await registerFormRoutes(app);

  // --- Public (site key) ---
  app.register(async (publicApi) => {
    publicApi.addHook("preHandler", requireSiteKey);
    publicApi.addHook("onSend", async (_request, reply, payload) => {
      reply.header("X-Aurora-Api-Version", API_VERSION);
      return payload;
    });

    publicApi.get<{ Querystring: { locale?: string } }>(
      "/api/v1/bootstrap",
      async (request) => {
        const websiteId = siteWebsiteIdFrom(request);
        const website = await getWebsiteLocales(websiteId);
        const locale = resolvePublicLocale(request.query.locale, website);
        return bootstrapPayload(websiteId, locale);
      },
    );

    publicApi.get("/api/v1/locales", async (request) => {
      const website = await getWebsiteLocales(siteWebsiteIdFrom(request));
      return publicLocalesPayload(website);
    });

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

    publicApi.get<{ Params: { apiId: string } }>(
      "/api/v1/content-types/:apiId/schema.json",
      async (request) => {
        const ct = await getContentTypeOrThrow(
          request.params.apiId,
          siteWebsiteIdFrom(request),
        );
        return contentTypeJsonSchema(ct.apiId, ct.name, ct.fields);
      },
    );

    publicApi.get<{
      Params: { apiId: string };
      Querystring: Record<string, string>;
    }>("/api/v1/content-types/:apiId/entries", async (request) => {
      const websiteId = siteWebsiteIdFrom(request);
      const website = await getWebsiteLocales(websiteId);
      const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
      const query = ListEntriesQuerySchema.parse(request.query);
      const locale = resolvePublicLocale(query.locale, website);

      const where = {
        contentTypeId: ct.id,
        status: EntryStatus.published,
        locale,
        ...(query.slug ? { slug: query.slug } : {}),
      };

      const sortOrderField = ct.fields.find((f) => f.apiId === "sortOrder");
      const { items, total } = await listEntriesOrdered({
        where,
        sort: query.sort,
        order: query.order,
        limit: query.limit,
        offset: query.offset,
        sortOrderFieldId: sortOrderField?.id ?? null,
      });

      trackContentRequest({
        websiteId,
        contentTypeApiId: ct.apiId,
        kind: "list",
      });

      return {
        items: items.map((e) => serializeEntry(e, { normalizeMedia: true })),
        total,
        limit: query.limit,
        offset: query.offset,
        sort: query.sort,
        order: query.order,
        locale,
      };
    });

    publicApi.get<{
      Params: { apiId: string; slug: string };
      Querystring: { previewToken?: string; locale?: string };
    }>("/api/v1/content-types/:apiId/entries/:slug", async (request) => {
      const websiteId = siteWebsiteIdFrom(request);
      const website = await getWebsiteLocales(websiteId);
      const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
      const locale = resolvePublicLocale(
        typeof request.query.locale === "string"
          ? request.query.locale
          : undefined,
        website,
      );
      const previewToken =
        typeof request.query.previewToken === "string"
          ? request.query.previewToken
          : undefined;

      let entry = await prisma.entry.findFirst({
        where: {
          contentTypeId: ct.id,
          slug: request.params.slug,
          locale,
          status: EntryStatus.published,
        },
        include: entryInclude,
      });

      if (!entry && previewToken) {
        const claims = verifyPreviewToken(previewToken);
        if (
          claims &&
          claims.websiteId === websiteId &&
          claims.contentTypeApiId === ct.apiId
        ) {
          entry = await prisma.entry.findFirst({
            where: {
              id: claims.entryId,
              contentTypeId: ct.id,
              slug: request.params.slug,
            },
            include: entryInclude,
          });
        }
      }

      if (!entry) {
        throw httpError(404, "Entry not found", "ENTRY_NOT_FOUND");
      }

      trackContentRequest({
        websiteId,
        contentTypeApiId: ct.apiId,
        entrySlug: entry.slug,
        kind: "get",
      });

      return serializeEntry(entry, { normalizeMedia: true });
    });
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
          localizationMode: body.localizationMode ?? "explicit",
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
            ...(body.localizationMode !== undefined
              ? { localizationMode: body.localizationMode }
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
        await assertRelatedContentType(websiteId, body.type, body.settings);
        const maxOrder = ct.fields.reduce(
          (max, f) => Math.max(max, f.sortOrder),
          -1,
        );
        const settingsJson = settingsToJson(body.settings ?? null);
        try {
          await prisma.fieldDefinition.create({
            data: {
              contentTypeId: ct.id,
              apiId: body.apiId,
              name: body.name,
              type: body.type,
              required: body.required,
              sortOrder: body.sortOrder ?? maxOrder + 1,
              ...(settingsJson !== undefined
                ? {
                    settings:
                      settingsJson === Prisma.JsonNull
                        ? Prisma.JsonNull
                        : settingsJson,
                  }
                : {}),
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

        const nextType = body.type ?? field.type;
        const nextSettings =
          body.settings !== undefined
            ? body.settings
            : (field.settings as { relatedContentTypeApiId?: string } | null);
        await assertRelatedContentType(websiteId, nextType, nextSettings);

        const settingsJson =
          body.settings !== undefined ? settingsToJson(body.settings) : undefined;

        await prisma.fieldDefinition.update({
          where: { id: field.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.required !== undefined ? { required: body.required } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            ...(settingsJson !== undefined
              ? {
                  settings:
                    settingsJson === Prisma.JsonNull
                      ? Prisma.JsonNull
                      : settingsJson,
                }
              : {}),
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
          ...(query.status ? { status: query.status } : {}),
          ...(query.locale ? { locale: query.locale } : {}),
          ...(query.slug
            ? { slug: query.slug }
            : query.q
              ? {
                  slug: {
                    contains: query.q,
                    mode: "insensitive" as const,
                  },
                }
              : {}),
        };
        const sortOrderField =
          query.sort === "sortOrder"
            ? ct.fields.find((f) => f.apiId === "sortOrder" && f.type === "number")
            : null;
        const { items, total } = await listEntriesOrdered({
          where,
          sort: query.sort,
          order: query.order,
          limit: query.limit,
          offset: query.offset,
          sortOrderFieldId: sortOrderField?.id ?? null,
        });
        return {
          items: items.map(serializeEntry),
          total,
          limit: query.limit,
          offset: query.offset,
          sort: query.sort,
          order: query.order,
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
        if (!entry) throw httpError(404, "Entry not found", "ENTRY_NOT_FOUND");
        return serializeEntry(entry);
      },
    );

    admin.post<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/preview-token",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const entry = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
          select: { id: true, slug: true },
        });
        if (!entry) throw httpError(404, "Entry not found", "ENTRY_NOT_FOUND");

        const { token, expiresAt } = mintPreviewToken({
          websiteId,
          entryId: entry.id,
          contentTypeApiId: ct.apiId,
        });

        const frontendBase =
          process.env.PUBLIC_FRONTEND_URL?.replace(/\/$/, "") ??
          "http://localhost:3000";
        // Convention: /preview/{type}/{slug}?previewToken=…
        const previewPath =
          ct.apiId === "page"
            ? entry.slug === "home"
              ? "/"
              : `/${entry.slug}`
            : ct.apiId === "post"
              ? `/blog/${entry.slug}`
              : ct.apiId === "doc"
                ? `/docs/${entry.slug}`
                : `/${ct.apiId}/${entry.slug}`;

        return {
          token,
          expiresAt,
          previewUrl: `${frontendBase}${previewPath}?previewToken=${encodeURIComponent(token)}`,
          apiUrl: `/api/v1/content-types/${ct.apiId}/entries/${entry.slug}?previewToken=${encodeURIComponent(token)}`,
        };
      },
    );

    admin.post<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const website = await getWebsiteLocales(websiteId);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = CreateEntrySchema.parse(request.body);
        const locale = body.locale ?? website.defaultLocale;
        assertLocaleOnWebsite(locale, website);

        const existing = await prisma.entry.findUnique({
          where: {
            contentTypeId_slug_locale: {
              contentTypeId: ct.id,
              slug: body.slug,
              locale,
            },
          },
        });
        if (existing) throw httpError(409, `Slug "${body.slug}" already exists for locale ${locale}`);

        const createdByUserId = asCreatedByUserId(userIdFrom(request));
        const entry = await prisma.entry.create({
          data: {
            contentTypeId: ct.id,
            slug: body.slug,
            locale,
            status: body.status,
            publishedAt:
              body.status === EntryStatus.published ? new Date() : null,
            ...(createdByUserId ? { createdByUserId } : {}),
          },
        });

        await setEntryFields(entry.id, ct.id, body.fields, websiteId, locale);

        if (ct.localizationMode === "all_locales") {
          await createAllLocaleSiblings({
            websiteId,
            contentTypeId: ct.id,
            sourceEntryId: entry.id,
            sourceLocale: locale,
            locales: website.locales,
            createdByUserId,
          });
        }

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

    admin.post<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId/translations",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const website = await getWebsiteLocales(websiteId);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = CreateTranslationSchema.parse(request.body);
        return createTranslationFromEntry({
          websiteId,
          contentTypeId: ct.id,
          sourceEntryId: request.params.entryId,
          locale: body.locale,
          website,
          createdByUserId: asCreatedByUserId(userIdFrom(request)),
        });
      },
    );

    admin.post<{ Params: { apiId: string } }>(
      "/api/v1/admin/content-types/:apiId/sync-locales",
      async (request) => {
        assertBuilder(request);
        const websiteId = websiteIdFrom(request);
        const website = await getWebsiteLocales(websiteId);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = SyncMissingLocalesSchema.parse(request.body ?? {});
        if (ct.localizationMode !== "all_locales") {
          throw httpError(
            400,
            "Sync locales is only available when localizationMode is all_locales",
            "VALIDATION_FAILED",
          );
        }
        return syncMissingLocalesForType({
          websiteId,
          contentTypeId: ct.id,
          locales: website.locales,
          dryRun: body.dryRun,
          createdByUserId: asCreatedByUserId(userIdFrom(request)),
        });
      },
    );

    admin.patch<{ Params: { apiId: string; entryId: string } }>(
      "/api/v1/admin/content-types/:apiId/entries/:entryId",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const website = await getWebsiteLocales(websiteId);
        const ct = await getContentTypeOrThrow(request.params.apiId, websiteId);
        const body = UpdateEntrySchema.parse(request.body);
        const existing = await prisma.entry.findFirst({
          where: { id: request.params.entryId, contentTypeId: ct.id },
        });
        if (!existing) throw httpError(404, "Entry not found");

        if (body.locale !== undefined) {
          assertLocaleOnWebsite(body.locale, website);
        }

        const nextLocale = body.locale ?? existing.locale;
        if (body.slug && body.slug !== existing.slug || body.locale && body.locale !== existing.locale) {
          const clash = await prisma.entry.findUnique({
            where: {
              contentTypeId_slug_locale: {
                contentTypeId: ct.id,
                slug: body.slug ?? existing.slug,
                locale: nextLocale,
              },
            },
          });
          if (clash && clash.id !== existing.id) {
            throw httpError(409, `Slug "${body.slug ?? existing.slug}" already exists for locale ${nextLocale}`);
          }
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
                ? existing.publishedAt ?? new Date()
                : null,
          },
        });

        if (body.fields) {
          await setEntryFields(
            existing.id,
            ct.id,
            body.fields,
            websiteId,
            nextLocale,
          );
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
