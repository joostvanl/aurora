import type { FastifyInstance } from "fastify";
import { z } from "zod";
import JSZip from "jszip";
import { prisma } from "../db.js";
import { requireWebsite, websiteIdFrom, userIdFrom } from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { asCreatedByUserId, entryInclude } from "../lib/entries.js";
import { formInclude, serializeForm } from "../lib/forms.js";
import { serializeEntry } from "../lib/serialize.js";
import {
  applyContentTypes,
  applyForms,
  FormSpecSchema,
  TypeSpecSchema,
  type ApplyMode,
  type FormSpec,
  type TypeSpec,
} from "../lib/provisionApply.js";
import {
  collectPackageMedia,
  importPackageMedia,
  publicApiBaseFromRequest,
  rewriteEntryFieldsMedia,
  type MediaMapEntry,
} from "../lib/packageMedia.js";

const ExportBodySchema = z.object({
  contentTypeApiIds: z.array(z.string().min(1)).default([]),
  /** When set for an apiId, only those entry slugs are exported (still includes the type schema). */
  entrySlugsByType: z.record(z.array(z.string().min(1))).optional(),
  formApiIds: z.array(z.string().min(1)).default([]),
  includeMedia: z.boolean().default(true),
});

const ImportModeSchema = z.enum(["overwrite", "skip"]);

const PackageContentSchema = z.object({
  contentTypes: z.array(TypeSpecSchema).default([]),
});

const PackageFormsSchema = z.object({
  forms: z.array(FormSpecSchema).default([]),
});

const MediaMapSchema = z.array(
  z.object({
    fromUrl: z.string().min(1),
    path: z.string().min(1),
  }),
);

const ManifestSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string().optional(),
  sourceSiteKey: z.string().nullable().optional(),
  selections: z
    .object({
      contentTypeApiIds: z.array(z.string()).optional(),
      formApiIds: z.array(z.string()).optional(),
      includeMedia: z.boolean().optional(),
    })
    .optional(),
});

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

async function buildContentExport(
  websiteId: string,
  apiIds: string[],
  entrySlugsByType?: Record<string, string[]>,
): Promise<{ contentTypes: TypeSpec[]; fieldRecords: Array<Record<string, unknown>> }> {
  const contentTypes: TypeSpec[] = [];
  const fieldRecords: Array<Record<string, unknown>> = [];

  for (const apiId of apiIds) {
    const ct = await prisma.contentType.findUnique({
      where: { websiteId_apiId: { websiteId, apiId } },
      include: {
        fields: { orderBy: { sortOrder: "asc" } },
        entries: { include: entryInclude },
      },
    });
    if (!ct) {
      throw httpError(404, `Content type "${apiId}" not found`);
    }

    const hasSlugFilter =
      entrySlugsByType != null && Object.prototype.hasOwnProperty.call(entrySlugsByType, apiId);
    const slugSet = hasSlugFilter
      ? new Set(entrySlugsByType![apiId] ?? [])
      : null;

    const entries = ct.entries
      .filter((entry) => (slugSet ? slugSet.has(entry.slug) : true))
      .map((entry) => {
        const flat = serializeEntry(entry);
        fieldRecords.push(flat.fields);
        return {
          slug: entry.slug,
          locale: entry.locale,
          status: entry.status as "draft" | "published",
          fields: flat.fields,
        };
      });

    contentTypes.push({
      apiId: ct.apiId,
      name: ct.name,
      description: ct.description ?? undefined,
      fields: ct.fields.map((f) => ({
        apiId: f.apiId,
        name: f.name,
        type: f.type,
        required: f.required,
        sortOrder: f.sortOrder,
        settings:
          f.settings && typeof f.settings === "object" && !Array.isArray(f.settings)
            ? (f.settings as { relatedContentTypeApiId?: string })
            : null,
      })),
      entries,
    });
  }

  return { contentTypes, fieldRecords };
}

async function buildFormsExport(
  websiteId: string,
  apiIds: string[],
): Promise<FormSpec[]> {
  const forms: FormSpec[] = [];
  for (const apiId of apiIds) {
    const form = await prisma.form.findUnique({
      where: { websiteId_apiId: { websiteId, apiId } },
      include: formInclude,
    });
    if (!form) {
      throw httpError(404, `Form "${apiId}" not found`);
    }
    const serialized = serializeForm(form);
    forms.push({
      apiId: serialized.apiId,
      name: serialized.name,
      description: serialized.description ?? null,
      submitLabel: serialized.submitLabel,
      successMessage: serialized.successMessage,
      enabled: serialized.enabled,
      fields: (serialized.fields ?? []).map((f) => ({
        apiId: f.apiId,
        label: f.label,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder ?? null,
        helpText: f.helpText ?? null,
        options: f.options ?? null,
        sortOrder: f.sortOrder,
      })),
    });
  }
  return forms;
}

export async function registerPackageRoutes(app: FastifyInstance) {
  app.register(async (scoped) => {
    scoped.addHook("preHandler", requireWebsite(RolePermission.admin));

    scoped.post("/api/v1/admin/packages/export", async (request, reply) => {
      const websiteId = websiteIdFrom(request);
      const body = ExportBodySchema.parse(request.body ?? {});

      if (
        body.contentTypeApiIds.length === 0 &&
        body.formApiIds.length === 0
      ) {
        throw httpError(
          400,
          "Select at least one content type or form to export",
        );
      }

      const website = await prisma.website.findUniqueOrThrow({
        where: { id: websiteId },
        select: { siteKey: true },
      });

      const { contentTypes, fieldRecords } = await buildContentExport(
        websiteId,
        body.contentTypeApiIds,
        body.entrySlugsByType,
      );
      const forms = await buildFormsExport(websiteId, body.formApiIds);

      let mediaMap: MediaMapEntry[] = [];
      let mediaFiles = new Map<string, Buffer>();
      if (body.includeMedia && fieldRecords.length > 0) {
        const collected = await collectPackageMedia(websiteId, fieldRecords);
        mediaMap = collected.mediaMap;
        mediaFiles = collected.files;
      }

      const zip = new JSZip();
      zip.file(
        "manifest.json",
        JSON.stringify(
          {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            sourceSiteKey: website.siteKey,
            selections: {
              contentTypeApiIds: body.contentTypeApiIds,
              entrySlugsByType: body.entrySlugsByType ?? null,
              formApiIds: body.formApiIds,
              includeMedia: body.includeMedia,
            },
          },
          null,
          2,
        ),
      );
      zip.file(
        "content.json",
        JSON.stringify({ contentTypes }, null, 2),
      );
      zip.file("forms.json", JSON.stringify({ forms }, null, 2));
      zip.file("media-map.json", JSON.stringify(mediaMap, null, 2));

      for (const [relPath, buf] of mediaFiles) {
        zip.file(relPath, buf);
      }

      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      });

      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `aurora-package-${website.siteKey}-${stamp}.zip`;

      return reply
        .header("Content-Type", "application/zip")
        .header(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        )
        .send(buffer);
    });

    scoped.post("/api/v1/admin/packages/import", async (request) => {
      const websiteId = websiteIdFrom(request);
      const query = z
        .object({ mode: ImportModeSchema.optional() })
        .parse(request.query ?? {});

      const file = await request.file({
        limits: { fileSize: MAX_PACKAGE_BYTES },
      });
      if (!file) {
        throw httpError(400, 'Expected multipart field "file"');
      }

      const fields = file.fields as Record<string, unknown>;
      const modeField = fields.mode;
      let modeRaw: string | undefined = query.mode;
      if (!modeRaw && modeField && typeof modeField === "object") {
        const single = Array.isArray(modeField) ? modeField[0] : modeField;
        if (
          single &&
          typeof single === "object" &&
          "value" in single &&
          typeof (single as { value: unknown }).value === "string"
        ) {
          modeRaw = (single as { value: string }).value;
        }
      }
      const mode: ApplyMode = ImportModeSchema.parse(modeRaw ?? "overwrite");

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (file.file.truncated) {
        throw httpError(400, "Package exceeds maximum size of 50MB");
      }
      const zipBuffer = Buffer.concat(chunks);

      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(zipBuffer);
      } catch {
        throw httpError(400, "Invalid ZIP package");
      }

      async function readJson<T>(name: string): Promise<unknown> {
        const entry = zip.file(name);
        if (!entry) {
          throw httpError(400, `Package missing ${name}`);
        }
        const text = await entry.async("string");
        try {
          return JSON.parse(text) as T;
        } catch {
          throw httpError(400, `Package ${name} is not valid JSON`);
        }
      }

      const manifest = ManifestSchema.parse(await readJson("manifest.json"));
      if (manifest.formatVersion !== 1) {
        throw httpError(400, "Unsupported package formatVersion");
      }

      const contentRaw = PackageContentSchema.parse(
        await readJson("content.json"),
      );
      const formsRaw = PackageFormsSchema.parse(await readJson("forms.json"));

      let mediaMap: MediaMapEntry[] = [];
      const mediaMapFile = zip.file("media-map.json");
      if (mediaMapFile) {
        mediaMap = MediaMapSchema.parse(
          JSON.parse(await mediaMapFile.async("string")),
        );
      }

      const publicBase = publicApiBaseFromRequest(request);
      const mediaResult = await importPackageMedia({
        websiteId,
        mediaMap,
        publicBase,
        getFile: async (zipPath) => {
          const entry = zip.file(zipPath);
          if (!entry) return null;
          return Buffer.from(await entry.async("uint8array"));
        },
      });

      const contentTypes: TypeSpec[] = contentRaw.contentTypes.map((ct) => ({
        ...ct,
        entries: ct.entries.map((entry) => ({
          ...entry,
          fields: entry.fields
            ? rewriteEntryFieldsMedia(entry.fields, mediaResult.urlMap)
            : entry.fields,
        })),
      }));

      const contentApply = await applyContentTypes(websiteId, contentTypes, {
        mode,
        createdByUserId: asCreatedByUserId(userIdFrom(request)),
      });
      const formsApply = await applyForms(websiteId, formsRaw.forms, { mode });

      return {
        ok: true as const,
        mode,
        formatVersion: manifest.formatVersion,
        sourceSiteKey: manifest.sourceSiteKey ?? null,
        contentTypes: contentApply.contentTypes,
        fields: contentApply.fields,
        entries: contentApply.entries,
        forms: formsApply.forms,
        formFields: formsApply.formFields,
        media: {
          imported: mediaResult.imported,
          skipped: mediaResult.skipped,
        },
        errors: mediaResult.errors,
      };
    });
  });
}
