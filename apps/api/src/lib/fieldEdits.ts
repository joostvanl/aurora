import type { FieldEditSummary } from "@cms/shared";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { applyStrReplace, normalizeNewlines } from "../ai/patches.js";
import { httpError, type ApiIssue } from "./httpError.js";

/** Field types that must not be patched via field_edits (routing / security). */
export const FIELD_EDIT_EXCLUDED_TYPES = new Set(["password", "slug"]);

export type FieldEditsInput = Record<
  string,
  Array<{ old_string: string; new_string: string; replace_all?: boolean }>
>;

function fieldEditConflict(
  fieldApiId: string,
  editIndex: number,
  code: "not_found" | "ambiguous",
  message: string,
): never {
  const issues: ApiIssue[] = [
    {
      path: ["field_edits", fieldApiId, editIndex],
      code,
      message,
    },
  ];
  throw httpError(
    409,
    `field_edits.${fieldApiId}[${editIndex}]: ${message}`,
    "CONFLICT",
    issues,
  );
}

function fieldEditValidation(
  fieldApiId: string,
  editIndex: number | null,
  message: string,
): never {
  const path: Array<string | number> =
    editIndex === null ? ["field_edits", fieldApiId] : ["field_edits", fieldApiId, editIndex];
  throw httpError(400, message, "VALIDATION_FAILED", [
    { path, code: "invalid_field_edit", message },
  ]);
}

function applyNormalizedStrReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  const normalizedContent = normalizeNewlines(content);
  const normalizedOld = normalizeNewlines(oldString);
  const normalizedNew = normalizeNewlines(newString);

  try {
    return applyStrReplace(
      normalizedContent,
      normalizedOld,
      normalizedNew,
      replaceAll,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      throw Object.assign(new Error(message), { fieldEditCode: "not_found" as const });
    }
    if (message.includes("multiple times")) {
      throw Object.assign(new Error(message), { fieldEditCode: "ambiguous" as const });
    }
    throw err;
  }
}

export async function lockEntryForUpdate(
  tx: Prisma.TransactionClient,
  entryId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Entry" WHERE id = ${entryId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw httpError(404, "Entry not found");
  }
}

export async function applyEntryFieldEdits(
  tx: Prisma.TransactionClient,
  params: {
    entryId: string;
    contentTypeId: string;
    fieldEdits: FieldEditsInput;
  },
): Promise<FieldEditSummary> {
  const { entryId, contentTypeId, fieldEdits } = params;

  const definitions = await tx.fieldDefinition.findMany({
    where: { contentTypeId },
  });
  const byApiId = new Map(definitions.map((d) => [d.apiId, d]));

  const fieldIds = new Set<string>();
  for (const apiId of Object.keys(fieldEdits)) {
    const def = byApiId.get(apiId);
    if (!def) {
      fieldEditValidation(apiId, null, `Unknown field "${apiId}"`);
    }
    if (FIELD_EDIT_EXCLUDED_TYPES.has(def.type)) {
      fieldEditValidation(
        apiId,
        null,
        `Field "${apiId}" of type "${def.type}" cannot be patched via field_edits`,
      );
    }
    fieldIds.add(def.id);
  }

  const existingValues = await tx.entryFieldValue.findMany({
    where: {
      entryId,
      fieldId: { in: [...fieldIds] },
    },
  });
  const valueByFieldId = new Map(existingValues.map((row) => [row.fieldId, row.value]));

  let applied = 0;
  const lengthsByApiId: Record<string, { length: number }> = {};
  const upserts: Array<{ fieldId: string; value: string }> = [];

  for (const [apiId, edits] of Object.entries(fieldEdits)) {
    const def = byApiId.get(apiId)!;
    const raw = valueByFieldId.get(def.id);
    if (raw === undefined || raw === null) {
      fieldEditValidation(
        apiId,
        0,
        `Field "${apiId}" has no string value to patch`,
      );
    }
    if (typeof raw !== "string") {
      fieldEditValidation(
        apiId,
        0,
        `Field "${apiId}" is not a string (got ${typeof raw})`,
      );
    }

    let current = raw;
    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = edits[editIndex]!;
      try {
        current = applyNormalizedStrReplace(
          current,
          edit.old_string,
          edit.new_string,
          edit.replace_all ?? false,
        );
        applied += 1;
      } catch (err) {
        const code =
          err instanceof Error && "fieldEditCode" in err
            ? (err as Error & { fieldEditCode: "not_found" | "ambiguous" }).fieldEditCode
            : undefined;
        const message = err instanceof Error ? err.message : String(err);
        if (code === "not_found" || code === "ambiguous") {
          fieldEditConflict(apiId, editIndex, code, message);
        }
        throw err;
      }
    }

    lengthsByApiId[apiId] = { length: current.length };
    upserts.push({ fieldId: def.id, value: current });
  }

  for (const { fieldId, value } of upserts) {
    await tx.entryFieldValue.upsert({
      where: {
        entryId_fieldId: { entryId, fieldId },
      },
      create: {
        entryId,
        fieldId,
        value: value as Prisma.InputJsonValue,
      },
      update: { value: value as Prisma.InputJsonValue },
    });
  }

  await tx.entry.update({
    where: { id: entryId },
    data: { updatedAt: new Date() },
  });

  return { applied, fields: lengthsByApiId };
}
