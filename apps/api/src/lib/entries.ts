import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const entryInclude = {
  contentType: true,
  fieldValues: { include: { field: true } },
} satisfies Prisma.EntryInclude;

export async function setEntryFields(
  entryId: string,
  contentTypeId: string,
  fields: Record<string, unknown>,
) {
  const definitions = await prisma.fieldDefinition.findMany({
    where: { contentTypeId },
  });
  const byApiId = new Map(definitions.map((d) => [d.apiId, d]));

  for (const [apiId, value] of Object.entries(fields)) {
    const def = byApiId.get(apiId);
    if (!def) continue;

    await prisma.entryFieldValue.upsert({
      where: {
        entryId_fieldId: { entryId, fieldId: def.id },
      },
      create: {
        entryId,
        fieldId: def.id,
        value: value as Prisma.InputJsonValue,
      },
      update: {
        value: value as Prisma.InputJsonValue,
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
    const err = new Error(`Content type "${apiId}" not found`);
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }
  return ct;
}
