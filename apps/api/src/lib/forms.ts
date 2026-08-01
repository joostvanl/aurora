import type {
  Form,
  FormField,
  FormFieldOption,
  FormSubmission,
} from "@cms/shared";
import type {
  Form as PrismaForm,
  FormField as PrismaFormField,
  FormSubmission as PrismaFormSubmission,
} from "@prisma/client";
import { prisma } from "../db.js";

export const formInclude = {
  fields: { orderBy: { sortOrder: "asc" as const } },
};

type FormWithFields = PrismaForm & { fields: PrismaFormField[] };

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

export async function getFormOrThrow(apiId: string, websiteId: string) {
  const form = await prisma.form.findUnique({
    where: { websiteId_apiId: { websiteId, apiId } },
    include: formInclude,
  });
  if (!form) throw httpError(404, `Form "${apiId}" not found`);
  return form;
}

function parseOptions(value: unknown): FormFieldOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: FormFieldOption[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      "value" in item &&
      "label" in item &&
      typeof (item as { value: unknown }).value === "string" &&
      typeof (item as { label: unknown }).label === "string"
    ) {
      options.push({
        value: (item as { value: string }).value,
        label: (item as { label: string }).label,
      });
    }
  }
  return options;
}

export function serializeFormField(field: PrismaFormField): FormField {
  return {
    id: field.id,
    apiId: field.apiId,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    helpText: field.helpText,
    options: parseOptions(field.options),
    sortOrder: field.sortOrder,
  };
}

export function serializeForm(form: FormWithFields): Form {
  return {
    id: form.id,
    apiId: form.apiId,
    name: form.name,
    description: form.description,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    enabled: form.enabled,
    fields: form.fields
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(serializeFormField),
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}

export function serializeFormSubmission(
  submission: PrismaFormSubmission,
  formApiId: string,
): FormSubmission {
  const payload =
    submission.payload &&
    typeof submission.payload === "object" &&
    !Array.isArray(submission.payload)
      ? (submission.payload as Record<string, unknown>)
      : {};
  const meta =
    submission.meta &&
    typeof submission.meta === "object" &&
    !Array.isArray(submission.meta)
      ? (submission.meta as Record<string, unknown>)
      : null;

  return {
    id: submission.id,
    formApiId,
    payload,
    meta,
    readAt: submission.readAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
  };
}
