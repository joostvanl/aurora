import type { FieldType } from "@cms/shared";
import { Prisma } from "@prisma/client";
import { httpError } from "./httpError.js";

export const LIST_FIELD_FILTER_SUPPORTED: ReadonlySet<FieldType> = new Set([
  "text",
  "textarea",
  "slug",
  "username",
  "relation",
  "relations",
  "number",
  "boolean",
  "datetime",
]);

export const LIST_FIELD_FILTER_UNSUPPORTED: ReadonlySet<FieldType> = new Set([
  "richtext",
  "media",
  "password",
]);

export type ListFieldFilter = {
  fieldId: string;
  fieldApiId: string;
  fieldType: FieldType;
  /** Original query tokens (trimmed). */
  values: string[];
  /** Coerced JSON values for Prisma `equals` / `array_contains`. */
  jsonValues: Prisma.InputJsonValue[];
};

type FieldLike = { id: string; apiId: string; type: string };

/**
 * Resolve `field` + `inValues` against content-type fields.
 * Returns null when no field filter is requested.
 */
export function resolveListFieldFilter(options: {
  fields: FieldLike[];
  fieldApiId?: string;
  inValues?: string[];
}): ListFieldFilter | null {
  const { fields, fieldApiId, inValues } = options;
  if (!fieldApiId) return null;
  if (!inValues || inValues.length === 0) {
    throw httpError(
      400,
      "Query param `in` is required when `field` is set",
      "VALIDATION_FAILED",
    );
  }

  const field = fields.find((f) => f.apiId === fieldApiId);
  if (!field) {
    throw httpError(
      400,
      `Unknown field apiId "${fieldApiId}"`,
      "VALIDATION_FAILED",
    );
  }

  const fieldType = field.type as FieldType;
  if (LIST_FIELD_FILTER_UNSUPPORTED.has(fieldType) || !LIST_FIELD_FILTER_SUPPORTED.has(fieldType)) {
    throw httpError(
      400,
      `Field type "${fieldType}" is not filterable (field "${fieldApiId}")`,
      "VALIDATION_FAILED",
    );
  }

  const jsonValues: Prisma.InputJsonValue[] = [];
  for (const token of inValues) {
    jsonValues.push(coerceInToken(token, fieldType, fieldApiId));
  }

  return {
    fieldId: field.id,
    fieldApiId: field.apiId,
    fieldType,
    values: inValues,
    jsonValues,
  };
}

function coerceInToken(
  token: string,
  fieldType: FieldType,
  fieldApiId: string,
): Prisma.InputJsonValue {
  switch (fieldType) {
    case "number": {
      const n = Number(token);
      if (!Number.isFinite(n)) {
        throw httpError(
          400,
          `Invalid number in \`in\` for field "${fieldApiId}": ${token}`,
          "VALIDATION_FAILED",
        );
      }
      return n;
    }
    case "boolean": {
      const lower = token.toLowerCase();
      if (lower === "true" || token === "1") return true;
      if (lower === "false" || token === "0") return false;
      throw httpError(
        400,
        `Invalid boolean in \`in\` for field "${fieldApiId}": ${token}`,
        "VALIDATION_FAILED",
      );
    }
    case "datetime":
    case "text":
    case "textarea":
    case "slug":
    case "username":
    case "relation":
    case "relations":
      return token;
    default:
      throw httpError(
        400,
        `Field type "${fieldType}" is not filterable (field "${fieldApiId}")`,
        "VALIDATION_FAILED",
      );
  }
}

/** Prisma `where` fragment for EntryFieldValue match. */
export function fieldFilterToPrismaSome(
  filter: ListFieldFilter,
): Prisma.EntryFieldValueListRelationFilter {
  if (filter.fieldType === "relations") {
    return {
      some: {
        fieldId: filter.fieldId,
        OR: filter.jsonValues.map((v) => ({
          value: { array_contains: v },
        })),
      },
    };
  }

  return {
    some: {
      fieldId: filter.fieldId,
      OR: filter.jsonValues.map((v) => ({
        value: { equals: v },
      })),
    },
  };
}

/**
 * SQL EXISTS clause matching EntryFieldValue for the current entry row alias `e`.
 * Scalar types compare `value #>> '{}'` to text tokens; `relations` uses array overlap.
 */
export function fieldFilterSqlExists(filter: ListFieldFilter): Prisma.Sql {
  const textValues = filter.values;
  if (filter.fieldType === "relations") {
    return Prisma.sql`AND EXISTS (
      SELECT 1
      FROM "EntryFieldValue" fv,
           LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fv.value) = 'array' THEN fv.value ELSE '[]'::jsonb END
           ) AS elem(val)
      WHERE fv."entryId" = e.id
        AND fv."fieldId" = ${filter.fieldId}
        AND elem.val IN (${Prisma.join(textValues)})
    )`;
  }

  // number/boolean: #>> '{}' yields text form ("42", "true") matching coerced values
  const matchTexts =
    filter.fieldType === "number" || filter.fieldType === "boolean"
      ? filter.jsonValues.map((v) => String(v))
      : textValues;

  return Prisma.sql`AND EXISTS (
    SELECT 1
    FROM "EntryFieldValue" fv
    WHERE fv."entryId" = e.id
      AND fv."fieldId" = ${filter.fieldId}
      AND (fv.value #>> '{}') IN (${Prisma.join(matchTexts)})
  )`;
}
