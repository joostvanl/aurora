import { createHash } from "node:crypto";
import { normalizeNewlines } from "../ai/patches.js";
import { httpError, type ApiIssue } from "./httpError.js";

export type FieldDigest = {
  sha256: string;
  length: number;
  byteLength: number;
};

/**
 * CAS digest for a stored string field.
 * Hash input: newline-normalized value (no trim; final newline kept as-is).
 * `length` is JS `string.length` of the original value.
 */
export function fieldDigest(value: string): FieldDigest {
  const normalized = normalizeNewlines(value);
  const hashBytes = Buffer.from(normalized, "utf8");
  return {
    sha256: createHash("sha256").update(hashBytes).digest("hex"),
    length: value.length,
    byteLength: Buffer.byteLength(value, "utf8"),
  };
}

export function sha256Hex(value: string): string {
  return fieldDigest(value).sha256;
}

export function fieldLength(value: string): number {
  return value.length;
}

export function byteLengthUtf8(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function hashesEqual(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

export function assertExpectedFieldHash(
  fieldApiId: string,
  currentValue: string,
  expectedHash: string,
  path: Array<string | number> = ["expected_field_hashes", fieldApiId],
): void {
  const actual = fieldDigest(currentValue).sha256;
  if (hashesEqual(actual, expectedHash)) return;
  const issues: ApiIssue[] = [
    {
      path,
      code: "STALE_HASH",
      message: `Field "${fieldApiId}" has changed since it was read`,
    },
  ];
  throw httpError(
    409,
    `Field "${fieldApiId}" has changed since it was read (stale hash)`,
    "STALE_HASH",
    issues,
  );
}
