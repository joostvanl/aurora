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
]);

export type FieldType = z.infer<typeof FieldTypeSchema>;

export const EntryStatusSchema = z.enum(["draft", "published"]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const FieldDefinitionSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  name: z.string(),
  type: FieldTypeSchema,
  required: z.boolean(),
  sortOrder: z.number(),
});

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const ContentTypeSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
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
});

export type CreateContentTypeInput = z.input<typeof CreateContentTypeSchema>;

export const UpdateContentTypeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

export type UpdateContentTypeInput = z.infer<typeof UpdateContentTypeSchema>;

export const CreateFieldDefinitionSchema = z.object({
  apiId: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "apiId must be lowercase alphanumeric"),
  name: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  sortOrder: z.number().int().optional(),
});

export type CreateFieldDefinitionInput = z.input<typeof CreateFieldDefinitionSchema>;

export const UpdateFieldDefinitionSchema = z.object({
  name: z.string().min(1).optional(),
  type: FieldTypeSchema.optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateFieldDefinitionInput = z.infer<typeof UpdateFieldDefinitionSchema>;

export const CreateEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be URL-safe"),
  locale: z.string().default("en"),
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
  locale: z.string().optional(),
  status: EntryStatusSchema.optional(),
  fields: z.record(z.unknown()).optional(),
});

export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>;

export const ListEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  slug: z.string().optional(),
  status: EntryStatusSchema.optional(),
});

export type ListEntriesQuery = z.infer<typeof ListEntriesQuerySchema>;

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
