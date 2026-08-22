import type { Prisma } from "@prisma/client";
import type { JsonEditOp, JsonEditSummary } from "@cms/shared";
import { httpError, type ApiIssue } from "./httpError.js";
import { FIELD_EDIT_EXCLUDED_TYPES } from "./fieldEdits.js";
import { isSecretField } from "./fields.js";
import { assertExpectedFieldHash, fieldDigest } from "./fieldHash.js";
import { parseJsonStrict, JsonStrictParseError } from "./parseJsonStrict.js";

export type JsonEditsInput = Record<string, JsonEditOp[]>;

function jsonEditError(
  status: number,
  fieldApiId: string,
  opIndex: number | null,
  code: string,
  message: string,
  apiCode: "VALIDATION_FAILED" | "CONFLICT" | "STALE_HASH" = "VALIDATION_FAILED",
): never {
  const path: Array<string | number> =
    opIndex === null
      ? ["json_edits", fieldApiId]
      : ["json_edits", fieldApiId, opIndex];
  const issues: ApiIssue[] = [{ path, code, message }];
  throw httpError(
    status,
    `json_edits.${fieldApiId}${opIndex === null ? "" : `[${opIndex}]`}: ${message}`,
    apiCode,
    issues,
  );
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Resolve a JSON Pointer. The final value must be an array. */
export function resolveArrayPointer(doc: unknown, pointer: string): unknown[] {
  if (pointer !== "" && !pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer ${JSON.stringify(pointer)}`);
  }
  if (pointer === "") {
    if (!Array.isArray(doc)) {
      throw new Error("JSON Pointer does not resolve to an array");
    }
    return doc;
  }
  const tokens = pointer.split("/").slice(1).map(decodePointerToken);
  let current: unknown = doc;
  for (const token of tokens) {
    if (current === null || typeof current !== "object") {
      throw new Error(`JSON Pointer ${JSON.stringify(pointer)} does not resolve`);
    }
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        throw new Error(`JSON Pointer ${JSON.stringify(pointer)} does not resolve`);
      }
      const idx = Number(token);
      if (idx < 0 || idx >= current.length) {
        throw new Error(`JSON Pointer ${JSON.stringify(pointer)} does not resolve`);
      }
      current = current[idx];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error(`JSON Pointer ${JSON.stringify(pointer)} does not resolve`);
    }
    current = (current as Record<string, unknown>)[token];
  }
  if (!Array.isArray(current)) {
    throw new Error("JSON Pointer does not resolve to an array");
  }
  return current;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => valuesEqual(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) {
    if (!valuesEqual(ao[key], bo[key])) return false;
  }
  return true;
}

/** Object matches when every `match` key equals (deep) the candidate's value. */
export function objectMatches(
  candidate: unknown,
  match: Record<string, unknown>,
): boolean {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const obj = candidate as Record<string, unknown>;
  for (const [key, expected] of Object.entries(match)) {
    if (!valuesEqual(obj[key], expected)) return false;
  }
  return true;
}

export function applyJsonOps(
  doc: unknown,
  ops: JsonEditOp[],
  fieldApiId: string,
): unknown {
  for (let i = 0; i < ops.length; i++) {
    applyOneOp(doc, ops[i]!, fieldApiId, i);
  }
  return doc;
}

function applyOneOp(
  doc: unknown,
  op: JsonEditOp,
  fieldApiId: string,
  opIndex: number,
): void {
  let arr: unknown[];
  try {
    arr = resolveArrayPointer(doc, op.path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jsonEditError(400, fieldApiId, opIndex, "invalid_json_path", message);
  }

  const indexes: number[] = [];
  for (let idx = 0; idx < arr.length; idx++) {
    if (objectMatches(arr[idx], op.match)) indexes.push(idx);
  }
  if (indexes.length === 0) {
    jsonEditError(
      409,
      fieldApiId,
      opIndex,
      "not_found",
      "No array object matched",
      "CONFLICT",
    );
  }
  if (indexes.length > 1) {
    jsonEditError(
      409,
      fieldApiId,
      opIndex,
      "ambiguous",
      "Match selected more than one object",
      "CONFLICT",
    );
  }

  const at = indexes[0]!;
  switch (op.op) {
    case "remove":
      arr.splice(at, 1);
      return;
    case "insert_after":
      arr.splice(at + 1, 0, structuredClone(op.value));
      return;
    case "insert_before":
      arr.splice(at, 0, structuredClone(op.value));
      return;
    case "replace_object":
      arr[at] = structuredClone(op.value);
      return;
    case "replace": {
      const current = arr[at];
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        jsonEditError(
          400,
          fieldApiId,
          opIndex,
          "invalid_json_edit",
          "replace requires the matched value to be an object",
        );
      }
      if (
        op.value === null ||
        typeof op.value !== "object" ||
        Array.isArray(op.value)
      ) {
        jsonEditError(
          400,
          fieldApiId,
          opIndex,
          "invalid_json_edit",
          "replace value must be an object",
        );
      }
      arr[at] = {
        ...(current as Record<string, unknown>),
        ...(op.value as Record<string, unknown>),
      };
      return;
    }
    default:
      jsonEditError(
        400,
        fieldApiId,
        opIndex,
        "invalid_json_edit",
        `Unknown op "${String((op as { op?: string }).op)}"`,
      );
  }
}

export function applyJsonEditsToString(
  raw: string,
  ops: JsonEditOp[],
  fieldApiId: string,
): string {
  let doc: unknown;
  try {
    doc = parseJsonStrict(raw);
  } catch (err) {
    const message =
      err instanceof JsonStrictParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    jsonEditError(
      400,
      fieldApiId,
      null,
      "invalid_json",
      `Field value is not valid JSON: ${message}`,
    );
  }
  applyJsonOps(doc, ops, fieldApiId);
  return JSON.stringify(doc, null, 2);
}

export async function applyEntryJsonEdits(
  tx: Prisma.TransactionClient,
  params: {
    entryId: string;
    contentTypeId: string;
    jsonEdits: JsonEditsInput;
    expectedHashes?: Record<string, string>;
  },
): Promise<JsonEditSummary> {
  const { entryId, contentTypeId, jsonEdits, expectedHashes } = params;

  const definitions = await tx.fieldDefinition.findMany({
    where: { contentTypeId },
  });
  const byApiId = new Map(definitions.map((d) => [d.apiId, d]));

  const fieldIds = new Set<string>();
  for (const apiId of Object.keys(jsonEdits)) {
    const def = byApiId.get(apiId);
    if (!def) {
      jsonEditError(400, apiId, null, "invalid_json_edit", `Unknown field "${apiId}"`);
    }
    if (isSecretField(def) || FIELD_EDIT_EXCLUDED_TYPES.has(def.type)) {
      jsonEditError(
        400,
        apiId,
        null,
        "invalid_json_edit",
        `Field "${apiId}" of type "${def.type}" cannot be patched via json_edits`,
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
  const fields: JsonEditSummary["fields"] = {};
  const upserts: Array<{ fieldId: string; apiId: string; value: string }> = [];

  for (const [apiId, ops] of Object.entries(jsonEdits)) {
    const def = byApiId.get(apiId)!;
    const raw = valueByFieldId.get(def.id);
    if (raw === undefined || raw === null) {
      jsonEditError(
        400,
        apiId,
        0,
        "invalid_json_edit",
        `Field "${apiId}" has no string value to patch`,
      );
    }
    if (typeof raw !== "string") {
      jsonEditError(
        400,
        apiId,
        0,
        "invalid_json_edit",
        `Field "${apiId}" is not a string (got ${typeof raw})`,
      );
    }

    const expected = expectedHashes?.[apiId];
    if (expected) {
      assertExpectedFieldHash(apiId, raw, expected, [
        "expected_field_hashes",
        apiId,
      ]);
    }

    const next = applyJsonEditsToString(raw, ops, apiId);
    applied += ops.length;
    const digest = fieldDigest(next);
    fields[apiId] = { length: digest.length, sha256: digest.sha256 };
    upserts.push({ fieldId: def.id, apiId, value: next });
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

  return { applied, fields };
}
