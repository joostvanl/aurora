import type {
  ContentType,
  Entry,
  EntryFieldValue,
  FieldDefinition,
} from "@prisma/client";
import type { FlatEntry, FieldSettings, MediaValue } from "@cms/shared";
import { serializeFieldSettings } from "./fieldSettings.js";
import { redactPasswordFieldValue } from "./passwordFields.js";
import { isSecretField } from "./fields.js";

type EntryWithRelations = Entry & {
  contentType: ContentType;
  fieldValues: Array<EntryFieldValue & { field: FieldDefinition }>;
  createdBy?: { id: string; name: string | null; email: string } | null;
};

type ContentTypeWithFields = ContentType & {
  fields: FieldDefinition[];
};

export function serializeContentType(ct: ContentTypeWithFields) {
  const mode =
    "localizationMode" in ct && ct.localizationMode
      ? ct.localizationMode
      : "explicit";
  return {
    id: ct.id,
    apiId: ct.apiId,
    name: ct.name,
    description: ct.description,
    localizationMode: mode as "explicit" | "all_locales",
    fields: ct.fields
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        id: f.id,
        apiId: f.apiId,
        name: f.name,
        type: f.type,
        required: f.required,
        sortOrder: f.sortOrder,
        settings: serializeFieldSettings(f.type, f.settings) as FieldSettings,
      })),
    createdAt: ct.createdAt.toISOString(),
    updatedAt: ct.updatedAt.toISOString(),
  };
}

/** Normalize media field values to a predictable object (accepts legacy URL strings). */
export function normalizeMediaValue(value: unknown): MediaValue | string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const url = value.trim();
    if (!url) return null;
    return { url, alt: "", width: null, height: null, mimeType: null };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const url =
      typeof obj.url === "string"
        ? obj.url.trim()
        : typeof obj.src === "string"
          ? obj.src.trim()
          : "";
    if (!url) return null;
    return {
      url,
      alt: typeof obj.alt === "string" ? obj.alt : "",
      width: typeof obj.width === "number" ? obj.width : null,
      height: typeof obj.height === "number" ? obj.height : null,
      mimeType: typeof obj.mimeType === "string" ? obj.mimeType : null,
    };
  }
  return null;
}

export function serializeEntry(entry: EntryWithRelations): FlatEntry;
export function serializeEntry(
  entry: EntryWithRelations,
  options: { normalizeMedia?: boolean },
): FlatEntry;
export function serializeEntry(
  entry: EntryWithRelations,
  options?: { normalizeMedia?: boolean },
): FlatEntry {
  const normalizeMedia = options?.normalizeMedia === true;
  const fields: Record<string, unknown> = {};
  for (const fv of entry.fieldValues) {
    if (isSecretField(fv.field)) {
      fields[fv.field.apiId] = redactPasswordFieldValue(fv.value);
      continue;
    }
    if (normalizeMedia && fv.field.type === "media") {
      fields[fv.field.apiId] = normalizeMediaValue(fv.value);
    } else {
      fields[fv.field.apiId] = fv.value;
    }
  }

  return {
    id: entry.id,
    slug: entry.slug,
    contentType: entry.contentType.apiId,
    status: entry.status,
    locale: entry.locale,
    fields,
    createdBy: entry.createdBy
      ? {
          id: entry.createdBy.id,
          name: entry.createdBy.name,
          email: entry.createdBy.email,
        }
      : null,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
