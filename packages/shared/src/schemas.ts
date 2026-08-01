import { z } from "zod";

export const FieldTypeSchema = z.enum([
  "text",
  "textarea",
  "richtext",
  "boolean",
  "datetime",
  "number",
  "slug",
  "media",
  "relation",
  "relations",
]);

export type FieldType = z.infer<typeof FieldTypeSchema>;

export const EntryStatusSchema = z.enum(["draft", "published"]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const LocalizationModeSchema = z.enum(["explicit", "all_locales"]);
export type LocalizationMode = z.infer<typeof LocalizationModeSchema>;

/** BCP-47 language-REGION, e.g. en-US, nl-NL. */
export const LocaleCodeSchema = z
  .string()
  .regex(/^[a-z]{2}-[A-Z]{2}$/, "locale must be language-REGION (e.g. en-US)");

export type LocaleCode = z.infer<typeof LocaleCodeSchema>;

export const ContentFormatSchema = z.enum(["html", "markdown", "plain"]);
export type ContentFormat = z.infer<typeof ContentFormatSchema>;

export const FieldSettingsSchema = z
  .object({
    relatedContentTypeApiId: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    /** How clients should render text-like field values. Always set on serialized defs. */
    contentFormat: ContentFormatSchema.optional(),
  })
  .passthrough();

export type FieldSettings = z.infer<typeof FieldSettingsSchema>;

/** Default contentFormat when not stored on the field. */
export function defaultContentFormat(type: FieldType): ContentFormat {
  if (type === "richtext") return "html";
  if (type === "textarea" || type === "text") return "plain";
  return "plain";
}

/** Media field value: legacy URL string or structured object. */
export const MediaValueSchema = z.object({
  url: z.string(),
  alt: z.string().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  mimeType: z.string().nullable().optional(),
});

export type MediaValue = {
  url: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
};

export const FieldDefinitionSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  name: z.string(),
  type: FieldTypeSchema,
  required: z.boolean(),
  sortOrder: z.number(),
  settings: FieldSettingsSchema.nullable().optional(),
});

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const ContentTypeSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  localizationMode: LocalizationModeSchema.default("explicit"),
  fields: z.array(FieldDefinitionSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ContentType = z.infer<typeof ContentTypeSchema>;

export const FlatEntrySchema = z.object({
  id: z.string(),
  slug: z.string(),
  contentType: z.string(),
  status: EntryStatusSchema,
  locale: z.string(),
  fields: z.record(z.unknown()),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FlatEntry = z.infer<typeof FlatEntrySchema>;

export const CreateContentTypeSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "apiId must be lowercase alphanumeric"),
  name: z.string().min(1),
  description: z.string().optional(),
  localizationMode: LocalizationModeSchema.optional(),
});

export type CreateContentTypeInput = z.input<typeof CreateContentTypeSchema>;

export const UpdateContentTypeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  localizationMode: LocalizationModeSchema.optional(),
});

export type UpdateContentTypeInput = z.infer<typeof UpdateContentTypeSchema>;

function refineRelationSettings(
  data: { type: FieldType; settings?: FieldSettings | null },
  ctx: z.RefinementCtx,
) {
  if (data.type === "relation" || data.type === "relations") {
    const related = data.settings?.relatedContentTypeApiId?.trim();
    if (!related) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "relatedContentTypeApiId is required for relation and relations fields",
        path: ["settings", "relatedContentTypeApiId"],
      });
    }
  }
}

export const CreateFieldDefinitionSchema = z
  .object({
    apiId: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, "apiId must be lowercase alphanumeric"),
    name: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    sortOrder: z.number().int().optional(),
    settings: FieldSettingsSchema.nullable().optional(),
  })
  .superRefine(refineRelationSettings);

export type CreateFieldDefinitionInput = z.input<typeof CreateFieldDefinitionSchema>;

export const UpdateFieldDefinitionSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: FieldTypeSchema.optional(),
    required: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    settings: FieldSettingsSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "relation" || data.type === "relations") {
      refineRelationSettings(
        { type: data.type, settings: data.settings ?? undefined },
        ctx,
      );
    }
  });

export type UpdateFieldDefinitionInput = z.infer<typeof UpdateFieldDefinitionSchema>;

export const CreateEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be URL-safe"),
  /** Omit to use the website defaultLocale. */
  locale: LocaleCodeSchema.optional(),
  status: EntryStatusSchema.default("draft"),
  fields: z.record(z.unknown()).default({}),
});

export type CreateEntryInput = z.input<typeof CreateEntrySchema>;

export const UpdateEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  locale: LocaleCodeSchema.optional(),
  status: EntryStatusSchema.optional(),
  fields: z.record(z.unknown()).optional(),
});

export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>;

export const CreateTranslationSchema = z.object({
  locale: LocaleCodeSchema,
});

export type CreateTranslationInput = z.infer<typeof CreateTranslationSchema>;

export const SyncMissingLocalesSchema = z.object({
  /** When true, only report missing locales without creating stubs. */
  dryRun: z.boolean().optional(),
});

export type SyncMissingLocalesInput = z.infer<typeof SyncMissingLocalesSchema>;

export const ListEntriesSortSchema = z.enum([
  "publishedAt",
  "createdAt",
  "updatedAt",
  "sortOrder",
]);

export type ListEntriesSort = z.infer<typeof ListEntriesSortSchema>;

export const ListEntriesOrderSchema = z.enum(["asc", "desc"]);
export type ListEntriesOrder = z.infer<typeof ListEntriesOrderSchema>;

export const ListEntriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    slug: z.string().optional(),
    status: EntryStatusSchema.optional(),
    /** Exact locale filter (e.g. nl-NL). Public API defaults to website.defaultLocale when omitted. */
    locale: LocaleCodeSchema.optional(),
    sort: ListEntriesSortSchema.optional(),
    order: ListEntriesOrderSchema.optional(),
  })
  .transform((q) => {
    const sort = q.sort ?? "publishedAt";
    const order = q.order ?? (sort === "sortOrder" ? "asc" : "desc");
    return { ...q, sort, order };
  });

export type ListEntriesQuery = z.infer<typeof ListEntriesQuerySchema>;

export const PublicLocalesResponseSchema = z.object({
  defaultLocale: LocaleCodeSchema,
  locales: z.array(
    z.object({
      code: LocaleCodeSchema,
      label: z.string(),
      flag: z.string(),
    }),
  ),
});

export type PublicLocalesResponse = z.infer<typeof PublicLocalesResponseSchema>;

// --- Forms ---

export const FormFieldTypeSchema = z.enum([
  "text",
  "email",
  "phone",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "honeypot",
]);

export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormFieldOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

export const FormFieldUiHintsSchema = z
  .object({
    rows: z.number().int().positive().optional(),
    autocomplete: z.string().optional(),
  })
  .passthrough();

export type FormFieldUiHints = z.infer<typeof FormFieldUiHintsSchema>;

export const FormFieldSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  label: z.string(),
  type: FormFieldTypeSchema,
  required: z.boolean(),
  placeholder: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  options: z.array(FormFieldOptionSchema).nullable().optional(),
  sortOrder: z.number(),
  uiHints: FormFieldUiHintsSchema.nullable().optional(),
});

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  submitLabel: z.string(),
  successMessage: z.string(),
  enabled: z.boolean(),
  fields: z.array(FormFieldSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Form = z.infer<typeof FormSchema>;

const apiIdField = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, "apiId must be lowercase alphanumeric");

export const CreateFormSchema = z.object({
  apiId: apiIdField,
  name: z.string().min(1),
  description: z.string().optional(),
  submitLabel: z.string().min(1).optional(),
  successMessage: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export type CreateFormInput = z.input<typeof CreateFormSchema>;

export const UpdateFormSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  submitLabel: z.string().min(1).optional(),
  successMessage: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateFormInput = z.infer<typeof UpdateFormSchema>;

export const CreateFormFieldSchema = z.object({
  apiId: apiIdField,
  label: z.string().min(1),
  type: FormFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  options: z.array(FormFieldOptionSchema).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateFormFieldInput = z.input<typeof CreateFormFieldSchema>;

export const UpdateFormFieldSchema = z.object({
  label: z.string().min(1).optional(),
  type: FormFieldTypeSchema.optional(),
  required: z.boolean().optional(),
  placeholder: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  options: z.array(FormFieldOptionSchema).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateFormFieldInput = z.infer<typeof UpdateFormFieldSchema>;

export const SubmitFormSchema = z.object({
  fields: z.record(z.unknown()),
});

export type SubmitFormInput = z.infer<typeof SubmitFormSchema>;

export const SubmitFormResultSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

export type SubmitFormResult = z.infer<typeof SubmitFormResultSchema>;

export const FormSubmissionSchema = z.object({
  id: z.string(),
  formApiId: z.string(),
  payload: z.record(z.unknown()),
  meta: z.record(z.unknown()).nullable().optional(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

export const UpdateFormSubmissionSchema = z.object({
  read: z.boolean().optional(),
});

export type UpdateFormSubmissionInput = z.infer<typeof UpdateFormSubmissionSchema>;

export const ListFormSubmissionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListFormSubmissionsQuery = z.infer<
  typeof ListFormSubmissionsQuerySchema
>;
