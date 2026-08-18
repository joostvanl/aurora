import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { prisma } from "../db.js";
import { httpError } from "./httpError.js";
import {
  normalizeRelationFieldValue,
  parseFieldSettings,
} from "./fieldSettings.js";
import {
  hashPasswordFieldValue,
  isPasswordLeaveUnchanged,
} from "./passwordFields.js";

export const entryInclude = {
  contentType: true,
  fieldValues: { include: { field: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.EntryInclude;

/**
 * Only real User ids may be stored as createdBy (website API tokens can use
 * synthetic `token:…` ids that are not in the User table).
 */
export function asCreatedByUserId(
  userId: string | null | undefined,
): string | null {
  if (!userId || userId.startsWith("token:")) return null;
  return userId;
}

export async function setEntryFields(
  entryId: string,
  contentTypeId: string,
  fields: Record<string, unknown>,
  websiteId?: string,
  locale?: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const contentType = await db.contentType.findUniqueOrThrow({
    where: { id: contentTypeId },
    select: { websiteId: true },
  });
  const siteId = websiteId ?? contentType.websiteId;

  let resolveLocale = locale;
  if (!resolveLocale) {
    const entry = await db.entry.findUnique({
      where: { id: entryId },
      select: { locale: true },
    });
    resolveLocale = entry?.locale;
  }
  if (!resolveLocale) {
    const website = await db.website.findUniqueOrThrow({
      where: { id: siteId },
      select: { defaultLocale: true },
    });
    resolveLocale = website.defaultLocale;
  }

  const definitions = await db.fieldDefinition.findMany({
    where: { contentTypeId },
  });
  const byApiId = new Map(definitions.map((d) => [d.apiId, d]));

  for (const [apiId, value] of Object.entries(fields)) {
    const def = byApiId.get(apiId);
    if (!def) continue;

    if (def.type === "password") {
      if (isPasswordLeaveUnchanged(value)) continue;
      const stored = hashPasswordFieldValue(value);
      await db.entryFieldValue.upsert({
        where: {
          entryId_fieldId: { entryId, fieldId: def.id },
        },
        create: {
          entryId,
          fieldId: def.id,
          value: stored,
        },
        update: { value: stored },
      });
      continue;
    }

    let stored: Prisma.InputJsonValue | typeof PrismaNS.JsonNull =
      value as Prisma.InputJsonValue;

    if (def.type === "relation" || def.type === "relations") {
      stored = await normalizeRelationFieldValue({
        websiteId: siteId,
        type: def.type,
        settings: parseFieldSettings(def.settings),
        value,
        required: def.required,
        fieldApiId: def.apiId,
        locale: resolveLocale,
      });
    }

    await db.entryFieldValue.upsert({
      where: {
        entryId_fieldId: { entryId, fieldId: def.id },
      },
      create: {
        entryId,
        fieldId: def.id,
        value: stored === PrismaNS.JsonNull ? PrismaNS.JsonNull : stored,
      },
      update: {
        value: stored === PrismaNS.JsonNull ? PrismaNS.JsonNull : stored,
      },
    });
  }
}

export async function getContentTypeOrThrow(apiId: string, websiteId: string) {
  const ct = await prisma.contentType.findUnique({
    where: {
      websiteId_apiId: { websiteId, apiId },
    },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!ct) {
    throw httpError(
      404,
      `Content type "${apiId}" not found`,
      "CONTENT_TYPE_NOT_FOUND",
    );
  }
  return ct;
}
