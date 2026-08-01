import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import type { ContentFormat, FieldSettings, FieldType } from "@cms/shared";
import { defaultContentFormat } from "@cms/shared";
import { prisma } from "../db.js";
import { httpError } from "./httpError.js";

export function parseFieldSettings(value: unknown): FieldSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const related =
    typeof obj.relatedContentTypeApiId === "string"
      ? obj.relatedContentTypeApiId.trim()
      : undefined;
  const contentFormat =
    obj.contentFormat === "html" ||
    obj.contentFormat === "markdown" ||
    obj.contentFormat === "plain"
      ? obj.contentFormat
      : undefined;
  return {
    ...obj,
    ...(related ? { relatedContentTypeApiId: related } : {}),
    ...(contentFormat ? { contentFormat } : {}),
  };
}

/** Settings object always including resolved contentFormat for text-like types. */
export function serializeFieldSettings(
  type: FieldType | string,
  value: unknown,
): FieldSettings {
  const parsed = parseFieldSettings(value) ?? {};
  const format: ContentFormat =
    parsed.contentFormat ?? defaultContentFormat(type as FieldType);
  return {
    ...parsed,
    contentFormat: format,
  };
}

export function settingsToJson(
  settings: FieldSettings | null | undefined,
): Prisma.InputJsonValue | typeof PrismaRuntime.JsonNull | undefined {
  if (settings === undefined) return undefined;
  if (settings === null) return PrismaRuntime.JsonNull;
  return settings as Prisma.InputJsonValue;
}

/** Ensure related content type exists on the website for relation fields. */
export async function assertRelatedContentType(
  websiteId: string,
  type: string,
  settings: FieldSettings | null | undefined,
) {
  if (type !== "relation" && type !== "relations") return;
  const relatedApiId = settings?.relatedContentTypeApiId?.trim();
  if (!relatedApiId) {
    throw httpError(
      400,
      "relatedContentTypeApiId is required for relation and relations fields",
      "VALIDATION_FAILED",
    );
  }
  const related = await prisma.contentType.findUnique({
    where: { websiteId_apiId: { websiteId, apiId: relatedApiId } },
    select: { id: true },
  });
  if (!related) {
    throw httpError(
      400,
      `Related content type "${relatedApiId}" not found on this website`,
      "VALIDATION_FAILED",
    );
  }
}

export async function normalizeRelationFieldValue(options: {
  websiteId: string;
  type: "relation" | "relations";
  settings: FieldSettings | null;
  value: unknown;
  required: boolean;
  fieldApiId: string;
  /** Locale used to resolve related entries; falls back to website defaultLocale. */
  locale?: string;
}): Promise<Prisma.InputJsonValue | typeof PrismaRuntime.JsonNull> {
  const relatedApiId = options.settings?.relatedContentTypeApiId?.trim();
  if (!relatedApiId) {
    throw httpError(
      400,
      `Field "${options.fieldApiId}" is missing relatedContentTypeApiId`,
      "VALIDATION_FAILED",
    );
  }

  const related = await prisma.contentType.findUnique({
    where: {
      websiteId_apiId: { websiteId: options.websiteId, apiId: relatedApiId },
    },
    select: { id: true },
  });
  if (!related) {
    throw httpError(
      400,
      `Related content type "${relatedApiId}" not found`,
      "VALIDATION_FAILED",
    );
  }

  let locale = options.locale;
  if (!locale) {
    const website = await prisma.website.findUniqueOrThrow({
      where: { id: options.websiteId },
      select: { defaultLocale: true },
    });
    locale = website.defaultLocale;
  }

  if (options.type === "relation") {
    if (options.value == null || options.value === "") {
      if (options.required) {
        throw httpError(
          400,
          `Field "${options.fieldApiId}" is required`,
          "VALIDATION_FAILED",
        );
      }
      return PrismaRuntime.JsonNull;
    }
    if (typeof options.value !== "string") {
      throw httpError(
        400,
        `Field "${options.fieldApiId}" must be a slug string`,
        "VALIDATION_FAILED",
      );
    }
    const slug = options.value.trim();
    const entry = await prisma.entry.findUnique({
      where: {
        contentTypeId_slug_locale: {
          contentTypeId: related.id,
          slug,
          locale,
        },
      },
      select: { id: true },
    });
    if (!entry) {
      throw httpError(
        400,
        `Related entry "${slug}" not found in "${relatedApiId}" (${locale})`,
        "VALIDATION_FAILED",
      );
    }
    return slug;
  }

  // relations (multi)
  let slugs: string[] = [];
  if (options.value == null || options.value === "") {
    slugs = [];
  } else if (Array.isArray(options.value)) {
    slugs = options.value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  } else if (typeof options.value === "string") {
    slugs = options.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  } else {
    throw httpError(
      400,
      `Field "${options.fieldApiId}" must be an array of slugs`,
      "VALIDATION_FAILED",
    );
  }

  const seen = new Set<string>();
  slugs = slugs.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  if (options.required && slugs.length === 0) {
    throw httpError(
      400,
      `Field "${options.fieldApiId}" is required`,
      "VALIDATION_FAILED",
    );
  }

  if (slugs.length > 0) {
    const found = await prisma.entry.findMany({
      where: {
        contentTypeId: related.id,
        locale,
        slug: { in: slugs },
      },
      select: { slug: true },
    });
    const foundSet = new Set(found.map((e) => e.slug));
    const missing = slugs.filter((s) => !foundSet.has(s));
    if (missing.length > 0) {
      throw httpError(
        400,
        `Related entries not found in "${relatedApiId}" (${locale}): ${missing.join(", ")}`,
        "VALIDATION_FAILED",
      );
    }
  }

  return slugs;
}
