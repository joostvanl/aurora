import type { ContentType, FieldDefinition, FieldType } from "@cms/shared";

export type BuiltinColumnId =
  | "slug"
  | "locale"
  | "status"
  | "updatedAt"
  | "createdAt"
  | "publishedAt";

export type ColumnId = BuiltinColumnId | `field:${string}`;

export type ColumnDef = {
  id: ColumnId;
  label: string;
  /** Whether this column can drive client-side sort. */
  sortable: boolean;
  kind: "builtin" | "field";
  fieldType?: FieldType;
};

export const BUILTIN_COLUMNS: ColumnDef[] = [
  { id: "slug", label: "Slug", sortable: true, kind: "builtin" },
  { id: "locale", label: "Locale", sortable: true, kind: "builtin" },
  { id: "status", label: "Status", sortable: true, kind: "builtin" },
  { id: "updatedAt", label: "Updated", sortable: true, kind: "builtin" },
  { id: "createdAt", label: "Created", sortable: true, kind: "builtin" },
  { id: "publishedAt", label: "Published", sortable: true, kind: "builtin" },
];

const DEFAULT_BUILTIN: BuiltinColumnId[] = [
  "slug",
  "locale",
  "status",
  "updatedAt",
];

/** Field types that are useful as table columns. */
const COLUMNABLE_FIELD_TYPES = new Set<FieldType>([
  "text",
  "textarea",
  "boolean",
  "datetime",
  "number",
  "slug",
  "media",
]);

function prefsKey(userId: string, websiteId: string, contentTypeApiId: string) {
  return `aurora_entries_columns:${userId}:${websiteId}:${contentTypeApiId}`;
}

export function fieldColumnId(apiId: string): ColumnId {
  return `field:${apiId}`;
}

export function isFieldColumnId(id: string): id is `field:${string}` {
  return id.startsWith("field:");
}

export function fieldApiIdFromColumn(id: `field:${string}`): string {
  return id.slice("field:".length);
}

export function columnableFields(
  fields: FieldDefinition[] | undefined,
): FieldDefinition[] {
  return (fields ?? []).filter((f) => COLUMNABLE_FIELD_TYPES.has(f.type));
}

export function availableColumns(type: ContentType): ColumnDef[] {
  const fieldCols: ColumnDef[] = columnableFields(type.fields).map((f) => ({
    id: fieldColumnId(f.apiId),
    label: f.name,
    sortable: f.type !== "media" && f.type !== "textarea",
    kind: "field" as const,
    fieldType: f.type,
  }));
  return [...BUILTIN_COLUMNS, ...fieldCols];
}

export function defaultColumnIds(type: ContentType): ColumnId[] {
  const fields = columnableFields(type.fields);
  const preferredTitle = fields.find((f) =>
    /^(title|name|label|heading)$/i.test(f.apiId),
  );
  const ids: ColumnId[] = [...DEFAULT_BUILTIN];
  if (preferredTitle) {
    // Insert title after slug
    ids.splice(1, 0, fieldColumnId(preferredTitle.apiId));
  }
  return ids;
}

export function loadColumnPrefs(
  userId: string,
  websiteId: string,
  contentTypeApiId: string,
  available: ColumnDef[],
): ColumnId[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(
    prefsKey(userId, websiteId, contentTypeApiId),
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set(available.map((c) => c.id));
    const ids = parsed.filter(
      (id): id is ColumnId => typeof id === "string" && allowed.has(id as ColumnId),
    );
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export function saveColumnPrefs(
  userId: string,
  websiteId: string,
  contentTypeApiId: string,
  columns: ColumnId[],
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    prefsKey(userId, websiteId, contentTypeApiId),
    JSON.stringify(columns),
  );
}
