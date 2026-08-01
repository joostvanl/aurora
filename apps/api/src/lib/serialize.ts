import type {
  ContentType,
  Entry,
  EntryFieldValue,
  FieldDefinition,
} from "@prisma/client";
import type { FlatEntry } from "@cms/shared";

type EntryWithRelations = Entry & {
  contentType: ContentType;
  fieldValues: Array<EntryFieldValue & { field: FieldDefinition }>;
};

type ContentTypeWithFields = ContentType & {
  fields: FieldDefinition[];
};

export function serializeContentType(ct: ContentTypeWithFields) {
  return {
    id: ct.id,
    apiId: ct.apiId,
    name: ct.name,
    description: ct.description,
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
      })),
    createdAt: ct.createdAt.toISOString(),
    updatedAt: ct.updatedAt.toISOString(),
  };
}

export function serializeEntry(entry: EntryWithRelations): FlatEntry {
  const fields: Record<string, unknown> = {};
  for (const fv of entry.fieldValues) {
    fields[fv.field.apiId] = fv.value;
  }

  return {
    id: entry.id,
    slug: entry.slug,
    contentType: entry.contentType.apiId,
    status: entry.status,
    locale: entry.locale,
    fields,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
