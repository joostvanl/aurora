import { z } from "zod";
import { FieldSettingsSchema, FieldTypeSchema, FormFieldTypeSchema, LocalizationModeSchema } from "@cms/shared";
import { EntryStatus, Prisma, type FormFieldType } from "@prisma/client";
import { prisma } from "../db.js";
import {
  getContentTypeOrThrow,
  setEntryFields,
  entryInclude,
} from "./entries.js";
import { serializeContentType, serializeEntry } from "./serialize.js";
import { formInclude, serializeForm } from "./forms.js";
import { settingsToJson } from "./fieldSettings.js";

export type ApplyMode = "overwrite" | "skip";

const FieldSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-zA-Z0-9_]*$/,
      "field apiId must start with a lowercase letter",
    ),
  name: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  settings: FieldSettingsSchema.nullable().optional(),
});

const EntrySpecSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locale: z
    .string()
    .regex(/^[a-z]{2}-[A-Z]{2}$/)
    .optional(),
  status: z.enum(["draft", "published"]).optional(),
  fields: z.record(z.unknown()).optional(),
});

export const TypeSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  localizationMode: LocalizationModeSchema.optional(),
  fields: z.array(FieldSpecSchema).default([]),
  entries: z.array(EntrySpecSchema).default([]),
});

export const ProvisionSchema = z.object({
  contentTypes: z.array(TypeSpecSchema).min(1),
});

export type TypeSpec = z.infer<typeof TypeSpecSchema>;

const FormFieldSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-zA-Z0-9_]*$/,
      "field apiId must start with a lowercase letter",
    ),
  label: z.string().min(1),
  type: FormFieldTypeSchema,
  required: z.boolean().optional(),
  placeholder: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  options: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
});

export const FormSpecSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  enabled: z.boolean().optional(),
  fields: z.array(FormFieldSpecSchema).default([]),
});

export type FormSpec = z.infer<typeof FormSpecSchema>;

export type ApplyCounters = {
  created: number;
  updated: number;
  skipped: number;
};

function emptyCounters(): ApplyCounters {
  return { created: 0, updated: 0, skipped: 0 };
}

export type ApplyContentResult = {
  results: Array<{
    contentType: ReturnType<typeof serializeContentType>;
    entries: ReturnType<typeof serializeEntry>[];
  }>;
  contentTypes: ApplyCounters;
  entries: ApplyCounters;
  fields: ApplyCounters;
};

export async function applyContentTypes(
  websiteId: string,
  contentTypes: TypeSpec[],
  options: { mode: ApplyMode } = { mode: "overwrite" },
): Promise<ApplyContentResult> {
  const mode = options.mode;
  const results: ApplyContentResult["results"] = [];
  const ctCounters = emptyCounters();
  const entryCounters = emptyCounters();
  const fieldCounters = emptyCounters();

  for (const spec of contentTypes) {
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
          localizationMode: spec.localizationMode ?? "explicit",
        },
        include: { fields: true },
      });
      ctCounters.created += 1;
    } else if (mode === "overwrite") {
      ct = await prisma.contentType.update({
        where: { id: ct.id },
        data: {
          name: spec.name,
          ...(spec.description !== undefined
            ? { description: spec.description }
            : {}),
          ...(spec.localizationMode !== undefined
            ? { localizationMode: spec.localizationMode }
            : {}),
        },
        include: { fields: true },
      });
      ctCounters.updated += 1;
    } else {
      ctCounters.skipped += 1;
    }

    const existingFields = new Map(ct.fields.map((f) => [f.apiId, f]));
    let order = ct.fields.reduce((max, f) => Math.max(max, f.sortOrder), -1);

    for (const field of spec.fields) {
      const current = existingFields.get(field.apiId);
      const settingsJson =
        field.settings !== undefined ? settingsToJson(field.settings) : undefined;
      if (current) {
        if (mode === "overwrite") {
          await prisma.fieldDefinition.update({
            where: { id: current.id },
            data: {
              name: field.name,
              type: field.type,
              required: field.required ?? current.required,
              sortOrder: field.sortOrder ?? current.sortOrder,
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
          fieldCounters.updated += 1;
        } else {
          fieldCounters.skipped += 1;
        }
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
            ...(settingsJson !== undefined && settingsJson !== Prisma.JsonNull
              ? { settings: settingsJson }
              : field.settings
                ? { settings: field.settings as Prisma.InputJsonValue }
                : {}),
          },
        });
        fieldCounters.created += 1;
      }
    }

    const fresh = await getContentTypeOrThrow(spec.apiId, websiteId);
    const entryResults = [];

    for (const entrySpec of spec.entries) {
      const locale = entrySpec.locale ?? "en-US";
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
        if (entrySpec.fields) {
          await setEntryFields(entry.id, fresh.id, entrySpec.fields);
        }
        entryCounters.created += 1;
      } else if (mode === "overwrite") {
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
        if (entrySpec.fields) {
          await setEntryFields(entry.id, fresh.id, entrySpec.fields);
        }
        entryCounters.updated += 1;
      } else {
        entryCounters.skipped += 1;
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

  return {
    results,
    contentTypes: ctCounters,
    entries: entryCounters,
    fields: fieldCounters,
  };
}

export type ApplyFormsResult = {
  forms: ApplyCounters;
  formFields: ApplyCounters;
  results: ReturnType<typeof serializeForm>[];
};

export async function applyForms(
  websiteId: string,
  forms: FormSpec[],
  options: { mode: ApplyMode } = { mode: "overwrite" },
): Promise<ApplyFormsResult> {
  const mode = options.mode;
  const formCounters = emptyCounters();
  const fieldCounters = emptyCounters();
  const results = [];

  for (const spec of forms) {
    let form = await prisma.form.findUnique({
      where: { websiteId_apiId: { websiteId, apiId: spec.apiId } },
      include: formInclude,
    });

    if (!form) {
      form = await prisma.form.create({
        data: {
          websiteId,
          apiId: spec.apiId,
          name: spec.name,
          description: spec.description ?? null,
          submitLabel: spec.submitLabel ?? "Submit",
          successMessage:
            spec.successMessage ?? "Thanks — we received your message.",
          enabled: spec.enabled ?? true,
        },
        include: formInclude,
      });
      formCounters.created += 1;
    } else if (mode === "overwrite") {
      form = await prisma.form.update({
        where: { id: form.id },
        data: {
          name: spec.name,
          ...(spec.description !== undefined
            ? { description: spec.description }
            : {}),
          ...(spec.submitLabel !== undefined
            ? { submitLabel: spec.submitLabel }
            : {}),
          ...(spec.successMessage !== undefined
            ? { successMessage: spec.successMessage }
            : {}),
          ...(spec.enabled !== undefined ? { enabled: spec.enabled } : {}),
        },
        include: formInclude,
      });
      formCounters.updated += 1;
    } else {
      formCounters.skipped += 1;
    }

    const existingFields = new Map(form.fields.map((f) => [f.apiId, f]));
    let order = form.fields.reduce((max, f) => Math.max(max, f.sortOrder), -1);

    for (const field of spec.fields) {
      const current = existingFields.get(field.apiId);
      const optionsValue =
        field.options === undefined
          ? undefined
          : field.options === null
            ? Prisma.JsonNull
            : (field.options as Prisma.InputJsonValue);

      if (current) {
        if (mode === "overwrite") {
          await prisma.formField.update({
            where: { id: current.id },
            data: {
              label: field.label,
              type: field.type as FormFieldType,
              required: field.required ?? current.required,
              ...(field.placeholder !== undefined
                ? { placeholder: field.placeholder }
                : {}),
              ...(field.helpText !== undefined
                ? { helpText: field.helpText }
                : {}),
              ...(optionsValue !== undefined ? { options: optionsValue } : {}),
              sortOrder: field.sortOrder ?? current.sortOrder,
            },
          });
          fieldCounters.updated += 1;
        } else {
          fieldCounters.skipped += 1;
        }
      } else {
        order += 1;
        await prisma.formField.create({
          data: {
            formId: form.id,
            apiId: field.apiId,
            label: field.label,
            type: field.type as FormFieldType,
            required: field.required ?? false,
            placeholder: field.placeholder ?? null,
            helpText: field.helpText ?? null,
            options:
              field.options === null || field.options === undefined
                ? Prisma.JsonNull
                : (field.options as Prisma.InputJsonValue),
            sortOrder: field.sortOrder ?? order,
          },
        });
        fieldCounters.created += 1;
      }
    }

    const fresh = await prisma.form.findUniqueOrThrow({
      where: { id: form.id },
      include: formInclude,
    });
    results.push(serializeForm(fresh));
  }

  return {
    forms: formCounters,
    formFields: fieldCounters,
    results,
  };
}
