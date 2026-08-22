import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { httpError } from "./httpError.js";
import { isSecretField } from "./fields.js";
import { assertExpectedFieldHash, fieldDigest } from "./fieldHash.js";

export const AI_ENTRY_FIELD_MAX_CHARS = 200_000;

export type EntryFieldRead = {
  entryId: string;
  fieldApiId: string;
  value: string;
  length: number;
  sha256: string;
  byteLength: number;
  truncated: false;
  updatedAt: string;
};

export async function readEntryStringField(
  params: {
    websiteId: string;
    contentTypeId: string;
    entryId: string;
    fieldApiId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EntryFieldRead> {
  const { contentTypeId, entryId, fieldApiId } = params;

  const entry = await db.entry.findFirst({
    where: { id: entryId, contentTypeId },
    select: { id: true, updatedAt: true },
  });
  if (!entry) throw httpError(404, "Entry not found", "ENTRY_NOT_FOUND");

  const def = await db.fieldDefinition.findFirst({
    where: { contentTypeId, apiId: fieldApiId },
  });
  if (!def) {
    throw httpError(
      400,
      `Unknown field "${fieldApiId}"`,
      "VALIDATION_FAILED",
      [
        {
          path: ["fieldApiId"],
          code: "unknown_field",
          message: `Unknown field "${fieldApiId}"`,
        },
      ],
    );
  }
  if (isSecretField(def)) {
    throw httpError(
      400,
      `Field "${fieldApiId}" is a secret field`,
      "VALIDATION_FAILED",
      [
        {
          path: ["fieldApiId"],
          code: "secret_field",
          message: `Field "${fieldApiId}" cannot be read`,
        },
      ],
    );
  }

  const row = await db.entryFieldValue.findUnique({
    where: { entryId_fieldId: { entryId: entry.id, fieldId: def.id } },
  });
  if (row == null || row.value == null) {
    throw httpError(
      400,
      `Field "${fieldApiId}" has no string value`,
      "VALIDATION_FAILED",
    );
  }
  if (typeof row.value !== "string") {
    throw httpError(
      400,
      `Field "${fieldApiId}" is not a string (got ${typeof row.value})`,
      "VALIDATION_FAILED",
    );
  }

  const digest = fieldDigest(row.value);
  return {
    entryId: entry.id,
    fieldApiId,
    value: row.value,
    length: digest.length,
    sha256: digest.sha256,
    byteLength: digest.byteLength,
    truncated: false,
    updatedAt: entry.updatedAt.toISOString(),
  };
}

/** Studio-AI envelope: full value up to 200k, otherwise no value. */
export function entryFieldForAi(field: EntryFieldRead): {
  ok: boolean;
  code?: "FIELD_TOO_LARGE";
  data: Omit<EntryFieldRead, "value"> & { value?: string };
} {
  if (field.length > AI_ENTRY_FIELD_MAX_CHARS) {
    const { value: _omit, ...rest } = field;
    return { ok: false, code: "FIELD_TOO_LARGE", data: rest };
  }
  return { ok: true, data: field };
}

export async function loadStringFieldValues(
  tx: Prisma.TransactionClient,
  params: {
    entryId: string;
    contentTypeId: string;
    fieldApiIds: string[];
  },
): Promise<Map<string, { type: string; value: string }>> {
  const { entryId, contentTypeId, fieldApiIds } = params;
  if (fieldApiIds.length === 0) return new Map();

  const definitions = await tx.fieldDefinition.findMany({
    where: { contentTypeId, apiId: { in: fieldApiIds } },
  });
  const byApiId = new Map(definitions.map((d) => [d.apiId, d]));
  const out = new Map<string, { type: string; value: string }>();

  for (const apiId of fieldApiIds) {
    const def = byApiId.get(apiId);
    if (!def) {
      throw httpError(
        400,
        `Unknown field "${apiId}"`,
        "VALIDATION_FAILED",
        [
          {
            path: ["expected_field_hashes", apiId],
            code: "unknown_field",
            message: `Unknown field "${apiId}"`,
          },
        ],
      );
    }
    const row = await tx.entryFieldValue.findUnique({
      where: { entryId_fieldId: { entryId, fieldId: def.id } },
    });
    if (row == null || typeof row.value !== "string") {
      throw httpError(
        400,
        `Field "${apiId}" has no string value to compare`,
        "VALIDATION_FAILED",
        [
          {
            path: ["expected_field_hashes", apiId],
            code: "invalid_field",
            message: `Field "${apiId}" has no string value to compare`,
          },
        ],
      );
    }
    out.set(apiId, { type: def.type, value: row.value });
  }
  return out;
}

export async function assertExpectedFieldHashes(
  tx: Prisma.TransactionClient,
  params: {
    entryId: string;
    contentTypeId: string;
    hashes?: Record<string, string>;
  },
): Promise<void> {
  const hashes = params.hashes;
  if (!hashes || Object.keys(hashes).length === 0) return;
  const current = await loadStringFieldValues(tx, {
    entryId: params.entryId,
    contentTypeId: params.contentTypeId,
    fieldApiIds: Object.keys(hashes),
  });
  for (const [apiId, expected] of Object.entries(hashes)) {
    assertExpectedFieldHash(apiId, current.get(apiId)!.value, expected, [
      "expected_field_hashes",
      apiId,
    ]);
  }
}
