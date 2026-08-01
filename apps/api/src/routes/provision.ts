import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FieldTypeSchema } from "@cms/shared";
import { EntryStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { requireWebsite, websiteIdFrom } from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import {
  getContentTypeOrThrow,
  setEntryFields,
  entryInclude,
} from "../lib/entries.js";
import { serializeContentType, serializeEntry } from "../lib/serialize.js";

const FieldSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const EntrySpecSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locale: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  fields: z.record(z.unknown()).optional(),
});

const TypeSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(FieldSpecSchema).default([]),
  entries: z.array(EntrySpecSchema).default([]),
});

export const ProvisionSchema = z.object({
  contentTypes: z.array(TypeSpecSchema).min(1),
});

/**
 * Idempotent provisioning for site-building agents:
 * ensure types + fields + entries in one call.
 */
export async function registerProvisionRoutes(app: FastifyInstance) {
  app.register(async (scoped) => {
    scoped.addHook("preHandler", requireWebsite(RolePermission.schema));

    scoped.post("/api/v1/admin/provision", async (request) => {
      const websiteId = websiteIdFrom(request);
      const body = ProvisionSchema.parse(request.body);
      const results = [];

      for (const spec of body.contentTypes) {
        let ct = await prisma.contentType.findUnique({
          where: { websiteId_apiId: { websiteId, apiId: spec.apiId } },
          include: { fields: true },
        });

        if (!ct) {
          ct = await prisma.contentType.create({
            data: {
              websiteId,
              apiId: spec.apiId,
              name: spec.name,
              description: spec.description,
            },
            include: { fields: true },
          });
        } else {
          ct = await prisma.contentType.update({
            where: { id: ct.id },
            data: {
              name: spec.name,
              ...(spec.description !== undefined
                ? { description: spec.description }
                : {}),
            },
            include: { fields: true },
          });
        }

        const existingFields = new Map(ct.fields.map((f) => [f.apiId, f]));
        let order = ct.fields.reduce((max, f) => Math.max(max, f.sortOrder), -1);

        for (const field of spec.fields) {
          const current = existingFields.get(field.apiId);
          if (current) {
            await prisma.fieldDefinition.update({
              where: { id: current.id },
              data: {
                name: field.name,
                type: field.type,
                required: field.required ?? current.required,
                sortOrder: field.sortOrder ?? current.sortOrder,
              },
            });
          } else {
            order += 1;
            await prisma.fieldDefinition.create({
              data: {
                contentTypeId: ct.id,
                apiId: field.apiId,
                name: field.name,
                type: field.type,
                required: field.required ?? false,
                sortOrder: field.sortOrder ?? order,
              },
            });
          }
        }

        const fresh = await getContentTypeOrThrow(spec.apiId, websiteId);
        const entryResults = [];

        for (const entrySpec of spec.entries) {
          const locale = entrySpec.locale ?? "en";
          const status =
            entrySpec.status === "published"
              ? EntryStatus.published
              : EntryStatus.draft;

          let entry = await prisma.entry.findUnique({
            where: {
              contentTypeId_slug_locale: {
                contentTypeId: fresh.id,
                slug: entrySpec.slug,
                locale,
              },
            },
          });

          if (!entry) {
            entry = await prisma.entry.create({
              data: {
                contentTypeId: fresh.id,
                slug: entrySpec.slug,
                locale,
                status,
                publishedAt: status === EntryStatus.published ? new Date() : null,
              },
            });
          } else {
            entry = await prisma.entry.update({
              where: { id: entry.id },
              data: {
                status,
                publishedAt:
                  status === EntryStatus.published
                    ? (entry.publishedAt ?? new Date())
                    : null,
              },
            });
          }

          if (entrySpec.fields) {
            await setEntryFields(entry.id, fresh.id, entrySpec.fields);
          }

          const full = await prisma.entry.findUniqueOrThrow({
            where: { id: entry.id },
            include: entryInclude,
          });
          entryResults.push(serializeEntry(full));
        }

        results.push({
          contentType: serializeContentType(fresh),
          entries: entryResults,
        });
      }

      return { ok: true as const, results };
    });
  });
}
